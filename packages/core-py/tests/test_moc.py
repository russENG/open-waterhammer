"""MOC 汎用エンジン テスト.

TypeScript 版 packages/core/src/__tests__/moc.test.ts からの移植。

検証:
    1. 単一管路バルブ閉そく（ジューコフスキー整合性）
    2. 閉そく時間延長で水撃圧低下
    3. 出力構造の正確性
    4. ポンプ急停止シナリオ
    5. 複数管路直列
    6. run_moc_single_pipe 便利 API（旧互換）
    7. GD² ポンプモデル
    8. エアチャンバ BC
    9. サージタンク BC
    10. 吸気弁 BC
    11. 減圧バルブ BC
    12. T字分岐（3管路ジャンクション）
    13. dt 整合化
    14. クーラン条件チェック
    15. 複合シナリオ
"""

import math
from dataclasses import replace

import pytest

from open_waterhammer import GRAVITY, Pipe, calc_wave_speed, joukowsky
from open_waterhammer.moc import (
    AirChamberBC,
    AirReleaseValveBC,
    DeadEndBC,
    MocNetwork,
    MocOptions,
    MocPipeSegment,
    PressureReducingValveBC,
    PumpBC,
    PumpTripInput,
    ReservoirBC,
    SinglePipeMocInput,
    SurgeTankBC,
    ValveBC,
    harmonize_time_step,
    run_moc,
    run_moc_pump_trip,
    run_moc_single_pipe,
)

# ── テスト用パイプ ─────────────────────────────────────────────────────────────

PIPE_DI_300 = Pipe(
    id="p1",
    start_node_id="N1",
    end_node_id="N2",
    pipe_type="ductile_iron",
    inner_diameter=0.300,
    wall_thickness=0.007,
    length=500,
    roughness_coeff=130,
)

V0 = 1.0
H0 = 30.0
A_DEFAULT = math.pi * 0.3 * 0.3 / 4
WAVE_SPEED = calc_wave_speed(PIPE_DI_300)
Q0_DEFAULT = V0 * A_DEFAULT


def single_pipe_network(close_time: float, operation: str = "close") -> MocNetwork:
    """ヘルパ: 単一管路（貯水槽→管→バルブ）ネットワーク."""
    f = 0.02
    hf = f * 500 * V0 * V0 / (2 * GRAVITY * 0.3)
    h_r = H0 + hf
    return MocNetwork(
        pipes=[
            MocPipeSegment(
                id="pipe_0",
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                n_reaches=10,
                upstream_node_id="up",
                downstream_node_id="dn",
            )
        ],
        nodes={
            "up": ReservoirBC(head=h_r),
            "dn": ValveBC(Q0=Q0_DEFAULT, H0v=H0, close_time=close_time, operation=operation),
        },
    )


# ═══════════════════════════════════════════════════════════════════════════════


class TestSinglePipeJoukowskyConsistency:
    """単一管路バルブ閉 — ジューコフスキー整合性."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_moc(single_pipe_network(0))  # 瞬時閉

    def test_dh_joukowsky_positive(self):
        d_h = joukowsky(WAVE_SPEED, -V0)
        assert d_h > 0

    def test_moc_hmax_matches_joukowsky_within_10pct(self, result):
        dn_h = result.nodes["dn"].H
        hmax_dn = max(p["H"] for p in dn_h)
        d_h_joukowsky = joukowsky(WAVE_SPEED, -V0)
        expected = H0 + d_h_joukowsky
        err = abs(hmax_dn - expected) / expected
        assert err < 0.10, (
            f"Hmax={hmax_dn:.1f}, expected≈{expected:.1f}, err={err * 100:.1f}%"
        )

    def test_hmax_at_n_above_h0(self, result):
        pipe0 = result.pipes["pipe_0"]
        assert pipe0.Hmax[10] > H0

    def test_hmin_at_n_at_or_below_h0(self, result):
        pipe0 = result.pipes["pipe_0"]
        assert pipe0.Hmin[10] <= H0


class TestSlowClosureReducesPressure:
    """閉そく時間延長で水撃圧低下."""

    def test_slow_less_than_instant(self):
        t0 = (4 * 500) / WAVE_SPEED
        r_instant = run_moc(single_pipe_network(0))
        r_slow = run_moc(single_pipe_network(t0 * 2))
        hmax_inst = max(p["H"] for p in r_instant.nodes["dn"].H)
        hmax_slow = max(p["H"] for p in r_slow.nodes["dn"].H)
        assert hmax_slow < hmax_inst, f"slow={hmax_slow:.1f}, instant={hmax_inst:.1f}"


class TestOutputStructure:
    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_moc(single_pipe_network(0))

    def test_pipe_0_exists(self, result):
        assert "pipe_0" in result.pipes

    def test_up_dn_nodes_exist(self, result):
        assert "up" in result.nodes
        assert "dn" in result.nodes

    def test_snapshot_node_count(self, result):
        for snap in result.pipes["pipe_0"].snapshots:
            assert len(snap.H) == 11

    def test_hmax_length(self, result):
        assert len(result.pipes["pipe_0"].Hmax) == 11

    def test_dt_equals_dx_over_a(self, result):
        ph = result.pipes["pipe_0"]
        expected = ph.dx / ph.wave_speed
        assert abs(result.dt - expected) < 1e-12

    def test_dn_h_length_at_least_100(self, result):
        assert len(result.nodes["dn"].H) >= 100


class TestSinglePipeConvenience:
    """run_moc_single_pipe 便利 API."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_moc_single_pipe(
            SinglePipeMocInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                initial_velocity=V0,
                initial_downstream_head=H0,
                close_time=0,
                n_reaches=10,
            )
        )

    def test_pipe_0_exists(self, result):
        assert "pipe_0" in result.pipes

    def test_downstream_head_rises_on_instant_close(self, result):
        hmax = max(p["H"] for p in result.nodes["downstream"].H)
        assert hmax > H0


class TestPumpTrip:
    """ポンプ急停止 — run_moc_pump_trip."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_moc_pump_trip(
            PumpTripInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                Q0=Q0_DEFAULT,
                pump_head=50,
                shutdown_time=1.0,
                check_valve=True,
                n_reaches=10,
            )
        )

    def test_no_crash(self, result):
        assert "pipe_0" in result.pipes

    def test_dead_end_h_recorded(self, result):
        assert len(result.nodes["dead_end_node"].H) > 0

    def test_negative_pressure_possible(self, result):
        hmin = min(p["H"] for p in result.nodes["pump_node"].H)
        assert hmin < 50


class TestSeriesPipes:
    """複数管路直列."""

    def test_series_works(self):
        pipe2 = replace(PIPE_DI_300, id="p2", length=200)
        a2 = calc_wave_speed(pipe2)
        hf1 = 0.02 * 500 * V0 * V0 / (2 * GRAVITY * 0.3)
        hf2 = 0.02 * 200 * V0 * V0 / (2 * GRAVITY * 0.3)
        h_r = H0 + hf1 + hf2

        network = MocNetwork(
            pipes=[
                MocPipeSegment(
                    id="pipe_1",
                    pipe=PIPE_DI_300,
                    wave_speed=WAVE_SPEED,
                    n_reaches=10,
                    upstream_node_id="res",
                    downstream_node_id="junction",
                ),
                MocPipeSegment(
                    id="pipe_2",
                    pipe=pipe2,
                    wave_speed=a2,
                    n_reaches=10,
                    upstream_node_id="junction",
                    downstream_node_id="valve",
                ),
            ],
            nodes={
                "res": ReservoirBC(head=h_r),
                "valve": ValveBC(Q0=Q0_DEFAULT, H0v=H0, close_time=0),
                # junction はダミー（内部ジャンクションとして扱われるが nodes に書いてもエラーにならない）
                "junction": ReservoirBC(head=H0 + hf2),
            },
        )
        r = run_moc(network, MocOptions(initial_flow=Q0_DEFAULT))
        assert "pipe_1" in r.pipes
        assert "pipe_2" in r.pipes
        hmax = max(p["H"] for p in r.nodes["valve"].H)
        assert hmax > H0, f"Hmax={hmax:.1f}"


class TestZeroVelocity:
    """V0=0（摩擦なし）でもクラッシュしない."""

    def test_v0_zero_completes(self):
        # 例外が出ないことを確認
        run_moc_single_pipe(
            SinglePipeMocInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                initial_velocity=0,
                initial_downstream_head=H0,
                close_time=0,
                n_reaches=10,
            )
        )


# ── GD² ポンプモデル ──────────────────────────────────────────────────────────


class TestGD2PumpModel:
    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_moc_pump_trip(
            PumpTripInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                Q0=Q0_DEFAULT,
                pump_head=50,
                Hs=60,
                GD2=500,
                N0=1450,
                eta0=0.80,
                shutdown_time=0,
                check_valve=True,
                n_reaches=10,
            )
        )

    def test_no_crash(self, result):
        assert "pipe_0" in result.pipes

    def test_n_series_recorded(self, result):
        assert result.nodes["pump_node"].N is not None
        assert len(result.nodes["pump_node"].N) > 0

    def test_n_decreases(self, result):
        ns = result.nodes["pump_node"].N
        n_last = ns[-1]["N"]
        assert n_last < 1450, f"N_last={n_last:.0f}"

    def test_hmin_below_pump_head(self, result):
        hmin = min(p["H"] for p in result.nodes["pump_node"].H)
        assert hmin < 50


# ── エアチャンバ BC ───────────────────────────────────────────────────────────


class TestAirChamber:
    """エアチャンバ BC — 負圧抑制."""

    def test_air_chamber_suppresses_negative_pressure(self):
        h0_pump = 50
        r_no_ac = run_moc_pump_trip(
            PumpTripInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                Q0=Q0_DEFAULT,
                pump_head=h0_pump,
                shutdown_time=0,
                check_valve=True,
                n_reaches=10,
            )
        )
        r_with_ac = run_moc(
            MocNetwork(
                pipes=[
                    MocPipeSegment(
                        id="pipe_0",
                        pipe=PIPE_DI_300,
                        wave_speed=WAVE_SPEED,
                        n_reaches=10,
                        upstream_node_id="pump",
                        downstream_node_id="ac",
                    )
                ],
                nodes={
                    "pump": PumpBC(
                        Q0=Q0_DEFAULT, H0=h0_pump, shutdown_time=0, check_valve=True
                    ),
                    "ac": AirChamberBC(V_air0=0.5, H_air0=h0_pump, polytropic_index=1.2),
                },
            ),
            MocOptions(initial_flow=Q0_DEFAULT),
        )
        assert "pipe_0" in r_with_ac.pipes
        assert r_with_ac.nodes["ac"].V_air is not None
        assert len(r_with_ac.nodes["ac"].V_air) > 0
        hmin_de = min(p["H"] for p in r_no_ac.nodes["dead_end_node"].H)
        hmin_ac = min(p["H"] for p in r_with_ac.nodes["ac"].H)
        assert hmin_ac > hmin_de, f"Hmin_ac={hmin_ac:.1f}, Hmin_de={hmin_de:.1f}"


# ── サージタンク BC ───────────────────────────────────────────────────────────


class TestSurgeTank:
    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        f_hw = 0.02
        hf = f_hw * 500 * V0 * V0 / (2 * GRAVITY * 0.3)
        h_r = H0 + hf
        return run_moc(
            MocNetwork(
                pipes=[
                    MocPipeSegment(
                        id="pipe_0",
                        pipe=PIPE_DI_300,
                        wave_speed=WAVE_SPEED,
                        n_reaches=10,
                        upstream_node_id="res",
                        downstream_node_id="st",
                    )
                ],
                nodes={
                    "res": ReservoirBC(head=h_r),
                    "st": SurgeTankBC(tank_area=5.0, initial_level=H0, datum=0),
                },
            ),
            MocOptions(initial_flow=Q0_DEFAULT),
        )

    def test_no_crash(self, result):
        assert "pipe_0" in result.pipes

    def test_z_recorded(self, result):
        assert result.nodes["st"].z is not None
        assert len(result.nodes["st"].z) > 0

    def test_water_level_oscillates(self, result):
        zs = [p["z"] for p in result.nodes["st"].z]
        z_max = max(zs)
        z_min = min(zs)
        assert z_max - z_min > 0.01, f"zMax={z_max:.3f}, zMin={z_min:.3f}"


# ── 吸気弁 BC ────────────────────────────────────────────────────────────────


class TestAirReleaseValve:
    def test_atmospheric_pressure_maintained(self):
        r = run_moc(
            MocNetwork(
                pipes=[
                    MocPipeSegment(
                        id="pipe_0",
                        pipe=PIPE_DI_300,
                        wave_speed=WAVE_SPEED,
                        n_reaches=10,
                        upstream_node_id="pump",
                        downstream_node_id="av",
                    )
                ],
                nodes={
                    "pump": PumpBC(
                        Q0=Q0_DEFAULT, H0=50, shutdown_time=0, check_valve=True
                    ),
                    "av": AirReleaseValveBC(atmospheric_head=10.33),
                },
            ),
            MocOptions(initial_flow=Q0_DEFAULT),
        )
        assert "pipe_0" in r.pipes
        hmin = min(p["H"] for p in r.nodes["av"].H)
        assert hmin >= 0, f"Hmin={hmin:.2f}"


# ── 減圧バルブ BC ─────────────────────────────────────────────────────────────


class TestPRV:
    def test_prv_holds_set_pressure(self):
        r = run_moc(
            MocNetwork(
                pipes=[
                    MocPipeSegment(
                        id="pipe_0",
                        pipe=PIPE_DI_300,
                        wave_speed=WAVE_SPEED,
                        n_reaches=10,
                        upstream_node_id="res",
                        downstream_node_id="prv",
                    )
                ],
                nodes={
                    "res": ReservoirBC(head=50),
                    "prv": PressureReducingValveBC(set_head=20, Q0=Q0_DEFAULT),
                },
            ),
            MocOptions(initial_flow=Q0_DEFAULT),
        )
        assert "pipe_0" in r.pipes
        h_prv = r.nodes["prv"].H
        h_tail = [p["H"] for p in h_prv[-50:]]
        h_avg = sum(h_tail) / len(h_tail)
        assert abs(h_avg - 20) < 5, f"H_avg={h_avg:.1f}, expected≈20"


# ── T字分岐 ───────────────────────────────────────────────────────────────────


class TestTeeBranch:
    """T字分岐 — 3管路ジャンクション."""

    def test_three_pipe_junction(self):
        pipe2 = replace(PIPE_DI_300, id="p2")
        pipe3 = replace(PIPE_DI_300, id="p3")
        a2 = calc_wave_speed(pipe2)
        a3 = calc_wave_speed(pipe3)
        q_branch = Q0_DEFAULT / 2

        r = run_moc(
            MocNetwork(
                pipes=[
                    MocPipeSegment(
                        id="pipe_1",
                        pipe=PIPE_DI_300,
                        wave_speed=WAVE_SPEED,
                        n_reaches=10,
                        upstream_node_id="res",
                        downstream_node_id="junction",
                    ),
                    MocPipeSegment(
                        id="pipe_2",
                        pipe=pipe2,
                        wave_speed=a2,
                        n_reaches=10,
                        upstream_node_id="junction",
                        downstream_node_id="valve1",
                        initial_flow=q_branch,
                    ),
                    MocPipeSegment(
                        id="pipe_3",
                        pipe=pipe3,
                        wave_speed=a3,
                        n_reaches=10,
                        upstream_node_id="junction",
                        downstream_node_id="valve2",
                        initial_flow=q_branch,
                    ),
                ],
                nodes={
                    "res": ReservoirBC(head=50),
                    "valve1": ValveBC(Q0=q_branch, H0v=H0, close_time=0),
                    "valve2": ValveBC(Q0=q_branch, H0v=H0, close_time=0),
                },
            ),
            MocOptions(initial_flow=Q0_DEFAULT),
        )
        assert "pipe_1" in r.pipes
        assert "pipe_2" in r.pipes
        assert "pipe_3" in r.pipes
        assert "junction" in r.nodes
        assert len(r.nodes["junction"].H) > 0
        hmax1 = max(p["H"] for p in r.nodes["valve1"].H)
        hmax2 = max(p["H"] for p in r.nodes["valve2"].H)
        assert hmax1 > H0, f"Hmax1={hmax1:.1f}"
        assert hmax2 > H0, f"Hmax2={hmax2:.1f}"


# ── dt 整合化 ────────────────────────────────────────────────────────────────


class TestHarmonizeTimeStep:
    """harmonize_time_step — Δt 統一化."""

    pipe_a = replace(PIPE_DI_300, id="pA", length=500)
    pipe_b = replace(PIPE_DI_300, id="pB", length=200)

    @property
    def a_a(self):
        return calc_wave_speed(self.pipe_a)

    @property
    def a_b(self):
        return calc_wave_speed(self.pipe_b)

    def test_single_pipe_unchanged(self):
        segs = [
            MocPipeSegment(
                id="s1",
                pipe=self.pipe_a,
                wave_speed=self.a_a,
                n_reaches=10,
                upstream_node_id="u",
                downstream_node_id="d",
            )
        ]
        new_segs, dt, warnings = harmonize_time_step(segs)
        assert new_segs[0].n_reaches == 10
        assert len(warnings) == 0
        assert abs(dt - 500 / (self.a_a * 10)) < 1e-12

    def test_dt_unified_to_min(self):
        segs = [
            MocPipeSegment(
                id="pA",
                pipe=self.pipe_a,
                wave_speed=self.a_a,
                n_reaches=10,
                upstream_node_id="u",
                downstream_node_id="j",
            ),
            MocPipeSegment(
                id="pB",
                pipe=self.pipe_b,
                wave_speed=self.a_b,
                n_reaches=10,
                upstream_node_id="j",
                downstream_node_id="d",
            ),
        ]
        new_segs, dt, _ = harmonize_time_step(segs)
        dt_a_raw = 500 / (self.a_a * 10)
        dt_b_raw = 200 / (self.a_b * 10)
        dt_min = min(dt_a_raw, dt_b_raw)
        assert abs(dt - dt_min) < 1e-12

    def test_dx_over_a_dt_close_to_one(self):
        segs = [
            MocPipeSegment(
                id="pA",
                pipe=self.pipe_a,
                wave_speed=self.a_a,
                n_reaches=10,
                upstream_node_id="u",
                downstream_node_id="j",
            ),
            MocPipeSegment(
                id="pB",
                pipe=self.pipe_b,
                wave_speed=self.a_b,
                n_reaches=10,
                upstream_node_id="j",
                downstream_node_id="d",
            ),
        ]
        new_segs, dt, _ = harmonize_time_step(segs)
        for s in new_segs:
            dx = s.pipe.length / s.n_reaches
            ratio = dx / (s.wave_speed * dt)
            assert abs(ratio - 1) < 0.06, f"{s.id}: dx/(a·dt)={ratio:.3f}"

    def test_n_reaches_minimum_one(self):
        tiny_pipe = replace(PIPE_DI_300, id="tiny", length=1)
        segs = [
            MocPipeSegment(
                id="long",
                pipe=self.pipe_a,
                wave_speed=self.a_a,
                n_reaches=100,
                upstream_node_id="u",
                downstream_node_id="j",
            ),
            MocPipeSegment(
                id="tiny",
                pipe=tiny_pipe,
                wave_speed=self.a_a,
                n_reaches=1,
                upstream_node_id="j",
                downstream_node_id="d",
            ),
        ]
        new_segs, _, _ = harmonize_time_step(segs)
        assert all(s.n_reaches >= 1 for s in new_segs)


# ── クーラン条件 ──────────────────────────────────────────────────────────────


class TestCFLCondition:
    def test_normal_velocity_no_warning(self):
        r = run_moc_single_pipe(
            SinglePipeMocInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                initial_velocity=1.0,
                initial_downstream_head=H0,
                close_time=0,
                n_reaches=10,
            )
        )
        cfl_warnings = [w for w in r.warnings if "V/a" in w]
        assert len(cfl_warnings) == 0

    def test_high_velocity_warns(self):
        r = run_moc_single_pipe(
            SinglePipeMocInput(
                pipe=PIPE_DI_300,
                wave_speed=WAVE_SPEED,
                initial_velocity=15.0,
                initial_downstream_head=H0,
                close_time=0,
                n_reaches=10,
            )
        )
        cfl_warnings = [w for w in r.warnings if "V/a" in w]
        assert len(cfl_warnings) > 0


# ── 複合シナリオ ──────────────────────────────────────────────────────────────


class TestPumpAndValveCompound:
    """§8.4.3 複合シナリオ — ポンプ→管路→バルブ."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return run_moc(
            MocNetwork(
                pipes=[
                    MocPipeSegment(
                        id="pipe_0",
                        pipe=PIPE_DI_300,
                        wave_speed=WAVE_SPEED,
                        n_reaches=10,
                        upstream_node_id="pump",
                        downstream_node_id="valve",
                    )
                ],
                nodes={
                    "pump": PumpBC(
                        Q0=Q0_DEFAULT,
                        H0=50,
                        Hs=60,
                        GD2=500,
                        N0=1450,
                        eta0=0.80,
                        shutdown_time=0,
                        check_valve=True,
                        mode="trip",
                    ),
                    "valve": ValveBC(
                        Q0=Q0_DEFAULT, H0v=30, close_time=2.0, operation="close"
                    ),
                },
            ),
            MocOptions(initial_flow=Q0_DEFAULT),
        )

    def test_no_crash(self, result):
        assert "pipe_0" in result.pipes
        assert "pump" in result.nodes
        assert "valve" in result.nodes

    def test_pump_n_decreases(self, result):
        ns = result.nodes["pump"].N
        assert ns[-1]["N"] < 1450

    def test_envelopes_oscillate(self, result):
        h_pump = [p["H"] for p in result.nodes["pump"].H]
        h_valve = [p["H"] for p in result.nodes["valve"].H]
        range_pump = max(h_pump) - min(h_pump)
        range_valve = max(h_valve) - min(h_valve)
        assert range_pump > 0.1, f"pump H range={range_pump:.2f}"
        assert range_valve > 0.1, f"valve H range={range_valve:.2f}"


class TestRunMocAppliesHarmonize:
    """run_moc は dt 整合化を適用する."""

    def test_uneven_lengths_complete(self):
        pipe_a = replace(PIPE_DI_300, id="pA", length=500)
        pipe_b = replace(PIPE_DI_300, id="pB", length=173)  # 半端な長さ
        a_a = calc_wave_speed(pipe_a)
        a_b = calc_wave_speed(pipe_b)

        network = MocNetwork(
            pipes=[
                MocPipeSegment(
                    id="pA",
                    pipe=pipe_a,
                    wave_speed=a_a,
                    n_reaches=10,
                    upstream_node_id="res",
                    downstream_node_id="j",
                ),
                MocPipeSegment(
                    id="pB",
                    pipe=pipe_b,
                    wave_speed=a_b,
                    n_reaches=10,
                    upstream_node_id="j",
                    downstream_node_id="valve",
                ),
            ],
            nodes={
                "res": ReservoirBC(head=H0 + 5),
                "valve": ValveBC(Q0=Q0_DEFAULT, H0v=H0, close_time=0),
            },
        )
        r = run_moc(network, MocOptions(initial_flow=Q0_DEFAULT))
        assert r.pipes["pA"].n_reaches >= 1
        assert r.pipes["pB"].n_reaches >= 1
        # dt は両管路共通
        dx_a_eff = r.pipes["pA"].dx
        dx_b_eff = r.pipes["pB"].dx
        dt_a = dx_a_eff / a_a
        dt_b = dx_b_eff / a_b
        assert abs(dt_a - r.dt) / r.dt < 0.06
        assert abs(dt_b - r.dt) / r.dt < 0.06
