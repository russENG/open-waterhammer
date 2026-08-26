"""防護工の境界条件 — 管路末端／管路途中（インライン）配置（issue #47）.

エアチャンバ・調圧水槽・吸気弁・減圧弁は、実務ではいずれも**管路の途中**に
設置する。従来の実装はこれらを「流入管 1 本の末端」としてしか解いておらず、
インライン配置では流出管の流量が 0 に固定され、防護工が完全閉そくとして
働いてしまっていた。

検証項目:
    D1  インライン配置で下流管の流量が 0 にならない
    D2  節点の連続条件 ΣQ_in − ΣQ_out = Q_dev が数値的に成立する
    D3  装置の状態量（空気容積・タンク水位）が変化する
    D4  防護効果（Hmax 低下・Hmin 上昇）が現れる
    D5  減圧弁は下流側を設定圧に保ち、上流側と異なる水頭を持つ
    D6  管路末端配置でも同じソルバーで整合が取れる（既存挙動の維持）

TypeScript 版の対応ファイル:
    packages/core/src/__tests__/protection-devices.test.ts
両者は同じ系・同じ許容差で検証しており、TS ↔ Python の一致も担保される。
"""

import pytest

from open_waterhammer import Pipe, calc_wave_speed
from open_waterhammer.moc import (
    AirChamberBC,
    AirReleaseValveBC,
    MocNetwork,
    MocOptions,
    MocPipeSegment,
    PressureReducingValveBC,
    ReservoirBC,
    SurgeTankBC,
    ValveBC,
    run_moc,
)

# ═══════════════════════════════════════════════════════════════════════════════
# 共通の系: 貯水槽 ─700m─ M ─700m─ バルブ（2 秒で閉）
# M に各種防護工を置く。t_max は save_every=1（毎ステップ記録）になるよう選ぶ。
# ═══════════════════════════════════════════════════════════════════════════════


def mk(pipe_id: str, length: float) -> Pipe:
    return Pipe(
        id=pipe_id, start_node_id="a", end_node_id="b", pipe_type="ductile_iron",
        inner_diameter=0.25, wall_thickness=0.006, length=length, roughness_coeff=130,
    )


A_WAVE = calc_wave_speed(mk("x", 100))
Q0 = 0.05
T_MAX = 15.0
TANK_AREA = 3.0
V_AIR0 = 0.5
H_AIR0 = 95.0
POLY_M = 1.2
H_ATM = 10.33
SET_HEAD = 60.0


def run_inline(device=None):
    nodes = {
        "R": ReservoirBC(head=100),
        "V": ValveBC(Q0=Q0, H0v=90, close_time=2, operation="close"),
    }
    if device is not None:
        nodes["M"] = device
    return run_moc(
        MocNetwork(
            pipes=[
                MocPipeSegment(id="up", pipe=mk("up", 700), wave_speed=A_WAVE, n_reaches=7,
                               upstream_node_id="R", downstream_node_id="M", initial_flow=Q0),
                MocPipeSegment(id="dn", pipe=mk("dn", 700), wave_speed=A_WAVE, n_reaches=7,
                               upstream_node_id="M", downstream_node_id="V", initial_flow=Q0),
            ],
            nodes=nodes,
        ),
        MocOptions(t_max=T_MAX, initial_flow=Q0),
    )


def node_flows(res):
    """節点 M における流入・流出流量の時系列."""
    up, dn = res.pipes["up"], res.pipes["dn"]
    return (
        [sn.Q[up.n_reaches] for sn in up.snapshots],
        [sn.Q[0] for sn in dn.snapshots],
    )


def air_chamber_bc():
    return AirChamberBC(V_air0=V_AIR0, H_air0=H_AIR0, polytropic_index=POLY_M)


def surge_tank_bc():
    return SurgeTankBC(tank_area=TANK_AREA, initial_level=95, datum=0)


def air_valve_bc():
    return AirReleaseValveBC(atmospheric_head=H_ATM)


def prv_bc():
    return PressureReducingValveBC(set_head=SET_HEAD, Q0=Q0)


DEVICE_FACTORIES = [
    ("エアチャンバ", air_chamber_bc),
    ("調圧水槽", surge_tank_bc),
    ("吸気弁", air_valve_bc),
    ("減圧弁", prv_bc),
]


# ─────────────────────────────────────────────────────────────────────────────
# D1 インライン配置で下流管が遮断されない
# ─────────────────────────────────────────────────────────────────────────────


class TestD1NoBlockage:
    @pytest.mark.parametrize(("name", "factory"), DEVICE_FACTORIES)
    def test_downstream_flow_not_pinned_to_zero(self, name, factory):
        _, qout = node_flows(run_inline(factory()))
        early = qout[1:6]
        assert any(abs(q) > 1e-6 for q in early), f"{name}: 下流管の流量が全て 0: {early}"

    def test_air_valve_matches_plain_junction_when_inactive(self):
        """吸気弁は節点水頭が大気圧を下回らない限り素の接合点と一致する."""
        _, base = node_flows(run_inline())
        _, av = node_flows(run_inline(air_valve_bc()))
        for k, (b, a) in enumerate(zip(base, av, strict=True)):
            assert b == pytest.approx(a, abs=1e-12), k


# ─────────────────────────────────────────────────────────────────────────────
# D2 節点の連続条件
# ─────────────────────────────────────────────────────────────────────────────


class TestD2Continuity:
    def test_air_chamber(self):
        """Q_in − Q_out = (V_prev − V_new)/Δt."""
        res = run_inline(air_chamber_bc())
        qin, qout = node_flows(res)
        v = [p["V"] for p in res.nodes["M"].V_air]
        assert len(v) == len(qin), "空気容積と流量の記録点数が揃っていない"
        max_err = max(
            abs((qin[k] - qout[k]) - (v[k - 1] - v[k]) / res.dt) for k in range(1, len(v))
        )
        assert max_err < 1e-9, f"連続条件の不釣り合い 最大 {max_err:.3e} m³/s"

    def test_surge_tank(self):
        """Q_in − Q_out = A_s·(z_new − z_prev)/Δt."""
        res = run_inline(surge_tank_bc())
        qin, qout = node_flows(res)
        z = [p["z"] for p in res.nodes["M"].z]
        assert len(z) == len(qin)
        max_err = max(
            abs((qin[k] - qout[k]) - TANK_AREA * (z[k] - z[k - 1]) / res.dt)
            for k in range(1, len(z))
        )
        assert max_err < 1e-9, f"連続条件の不釣り合い 最大 {max_err:.3e} m³/s"

    @pytest.mark.parametrize(("name", "factory"), [("吸気弁", air_valve_bc), ("減圧弁", prv_bc)])
    def test_no_device_flow(self, name, factory):
        """吸気弁（非作動）と減圧弁（通常制御）は Q_in = Q_out."""
        qin, qout = node_flows(run_inline(factory()))
        max_err = max(abs(a - b) for a, b in zip(qin, qout, strict=True))
        assert max_err < 1e-9, f"{name}: Q_in ≠ Q_out（最大差 {max_err:.3e}）"

    def test_plain_junction(self):
        qin, qout = node_flows(run_inline())
        max_err = max(abs(a - b) for a, b in zip(qin, qout, strict=True))
        assert max_err < 1e-12


# ─────────────────────────────────────────────────────────────────────────────
# D3 装置の状態量が変化する
# ─────────────────────────────────────────────────────────────────────────────


class TestD3DeviceState:
    def test_air_volume_compresses_and_expands(self):
        v = [p["V"] for p in run_inline(air_chamber_bc()).nodes["M"].V_air]
        assert min(v) < v[0] - 1e-6, f"圧縮していない（最小 {min(v)}）"
        assert max(v) > v[0] + 1e-6, f"膨張していない（最大 {max(v)}）"

    def test_air_volume_respects_floor(self):
        v = [p["V"] for p in run_inline(air_chamber_bc()).nodes["M"].V_air]
        assert min(v) >= V_AIR0 * 0.02 - 1e-12

    def test_tank_level_oscillates(self):
        z = [p["z"] for p in run_inline(surge_tank_bc()).nodes["M"].z]
        assert max(z) - min(z) > 1e-3

    def test_head_follows_polytropic_law(self):
        """節点水頭がポリトロープ気体則 H·V^m = H_a0·V_a0^m と整合する."""
        res = run_inline(air_chamber_bc())
        v_series = res.nodes["M"].V_air
        h_series = res.nodes["M"].H
        ref = H_AIR0 * V_AIR0**POLY_M
        max_rel = 0.0
        for k in range(1, len(v_series)):
            t = v_series[k]["t"]
            hk = next(p["H"] for p in h_series if abs(p["t"] - t) < 1e-12)
            max_rel = max(max_rel, abs(hk * v_series[k]["V"] ** POLY_M / ref - 1))
        assert max_rel < 1e-6, f"気体則からのずれ 最大 {max_rel * 100:.6f}%"


# ─────────────────────────────────────────────────────────────────────────────
# D4 防護効果
# ─────────────────────────────────────────────────────────────────────────────


class TestD4ProtectionEffect:
    @pytest.fixture(scope="class")
    @classmethod
    def baseline(cls):
        dn = run_inline().pipes["dn"]
        return max(dn.Hmax), min(dn.Hmin)

    def test_baseline_has_negative_pressure(self, baseline):
        assert baseline[1] < 0, f"防護なし Hmin={baseline[1]:.2f} m"

    @pytest.mark.parametrize(
        ("name", "factory"), [("エアチャンバ", air_chamber_bc), ("調圧水槽", surge_tank_bc)]
    )
    def test_reduces_max_head(self, baseline, name, factory):
        hmax = max(run_inline(factory()).pipes["dn"].Hmax)
        assert hmax < baseline[0], f"{name} Hmax={hmax:.2f} ≧ 防護なし {baseline[0]:.2f}"

    @pytest.mark.parametrize(
        ("name", "factory"), [("エアチャンバ", air_chamber_bc), ("調圧水槽", surge_tank_bc)]
    )
    def test_raises_min_head(self, baseline, name, factory):
        hmin = min(run_inline(factory()).pipes["dn"].Hmin)
        assert hmin > baseline[1], f"{name} Hmin={hmin:.2f} ≦ 防護なし {baseline[1]:.2f}"


# ─────────────────────────────────────────────────────────────────────────────
# D5 減圧弁
# ─────────────────────────────────────────────────────────────────────────────


class TestD5PressureReducingValve:
    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_inline(prv_bc())

    def test_downstream_head_held_at_set_head(self, result):
        dn = result.pipes["dn"]
        controlled = [sn.H[0] for sn in dn.snapshots if sn.Q[0] > 1e-6]
        assert len(controlled) > 10, "制御中のステップが少なすぎる"
        for h in controlled:
            assert h == pytest.approx(SET_HEAD, abs=1e-9)

    def test_upstream_head_above_set_head(self, result):
        up, dn = result.pipes["up"], result.pipes["dn"]
        count = 0
        for k, sn in enumerate(dn.snapshots):
            if sn.Q[0] <= 1e-6:
                continue
            count += 1
            assert up.snapshots[k].H[up.n_reaches] >= SET_HEAD - 1e-9, k
        assert count > 10

    def test_reduces_downstream_max_head(self, result):
        base_max = max(run_inline().pipes["dn"].Hmax)
        prv_max = max(result.pipes["dn"].Hmax)
        assert prv_max < base_max, f"PRV Hmax={prv_max:.2f} ≧ 防護なし {base_max:.2f}"


# ─────────────────────────────────────────────────────────────────────────────
# D6 管路末端配置（既存挙動の維持）
# ─────────────────────────────────────────────────────────────────────────────


def run_terminus(device):
    return run_moc(
        MocNetwork(
            pipes=[
                MocPipeSegment(id="p", pipe=mk("p", 700), wave_speed=A_WAVE, n_reaches=7,
                               upstream_node_id="R", downstream_node_id="M", initial_flow=Q0),
            ],
            nodes={"R": ReservoirBC(head=100), "M": device},
        ),
        MocOptions(t_max=T_MAX, initial_flow=Q0),
    )


class TestD6TerminusPlacement:
    def test_air_chamber(self):
        res = run_terminus(air_chamber_bc())
        p = res.pipes["p"]
        qin = [sn.Q[p.n_reaches] for sn in p.snapshots]
        v = [x["V"] for x in res.nodes["M"].V_air]
        max_err = max(abs(qin[k] - (v[k - 1] - v[k]) / res.dt) for k in range(1, len(v)))
        assert max_err < 1e-9, f"不釣り合い 最大 {max_err:.3e}"

    def test_surge_tank(self):
        res = run_terminus(surge_tank_bc())
        p = res.pipes["p"]
        qin = [sn.Q[p.n_reaches] for sn in p.snapshots]
        z = [x["z"] for x in res.nodes["M"].z]
        max_err = max(
            abs(qin[k] - TANK_AREA * (z[k] - z[k - 1]) / res.dt) for k in range(1, len(z))
        )
        assert max_err < 1e-9, f"不釣り合い 最大 {max_err:.3e}"

    def test_air_valve_holds_atmospheric_head(self):
        h = [p["H"] for p in run_terminus(air_valve_bc()).nodes["M"].H]
        assert min(h) >= H_ATM - 1e-9, f"最小 {min(h):.4f} m"

    def test_prv_holds_set_head(self):
        h = [p["H"] for p in run_terminus(prv_bc()).nodes["M"].H]
        for v in h[1:]:
            assert v == pytest.approx(SET_HEAD, abs=1e-9)


# ─────────────────────────────────────────────────────────────────────────────
# TS 実装との数値パリティ
# ─────────────────────────────────────────────────────────────────────────────


class TestParityWithTypeScript:
    """TS 側 protection-devices.test.ts と同じ系で同じ数値になる."""

    @pytest.mark.parametrize(
        ("factory", "expected_hmin", "expected_hmax"),
        [
            (air_chamber_bc, 48.670224, 175.151322),
            (surge_tank_bc, 42.571448, 154.425054),
            (prv_bc, 60.000000, 99.421029),
        ],
    )
    def test_downstream_envelope_matches_ts(self, factory, expected_hmin, expected_hmax):
        dn = run_inline(factory()).pipes["dn"]
        assert min(dn.Hmin) == pytest.approx(expected_hmin, abs=1e-5)
        assert max(dn.Hmax) == pytest.approx(expected_hmax, abs=1e-5)
