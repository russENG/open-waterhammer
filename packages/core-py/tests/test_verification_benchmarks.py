"""検証ベンチマーク（Python コア）— 解析解・厳密解との突き合わせ.

既存の test_moc.py / test_steady_to_moc.py は「クラッシュしない」「相対的に
増える/減る」という挙動テストが中心である。本ファイルはそれとは別に、
**独立に導出できる解析解と数値を突き合わせる**ことで、実運用エンジンである
Python コアの計算そのものを検証する（V&V: Verification & Validation）。

TypeScript 版の対応ファイル:
    packages/core/src/__tests__/verification-benchmarks.test.ts
両者は同じ解析解に対して同じ許容差で検証しており、実質的に
TS ↔ Python の実装一致（parity）も担保される。

── 定常計算 ────────────────────────────────────────────────────────────────
    S1  ヘーゼン・ウィリアムス式の閉形式（EPANET SI 係数式）との一致
    S2  直列管路のエネルギー収支 H_R − H_end = Σ損失
    S3  樹枝状網の連続条件
    S4  局部損失 Σf·v²/2g の閉形式一致
    S5  【適用限界】樹枝状・単一貯水槽・demand ノード前提を外れた入力の挙動

── 非定常計算（MOC）─────────────────────────────────────────────────────────
    T1  ジューコフスキーの式（瞬時閉・摩擦なし）ΔH = a·V₀/g
    T2  格子収束性
    T3  圧力波の周期 4L/a と位相
    T4  定常保持
    T5  分岐点の連続条件と節点水頭の一意性
    T6  断面変化点の透過係数 2B₁/(B₁+B₂)
    T7  アリエビ連鎖式（摩擦なし緩閉そくの厳密解）との一致
    T8  摩擦による減衰が単調であること
    T9  CFL 条件 Δt = Δx/a
    T10 【適用限界】境界節点の負圧が 0 m で打ち切られる
"""

import math
from dataclasses import replace

import pytest

from open_waterhammer import GRAVITY, Pipe, joukowsky
from open_waterhammer.moc import (
    MocNetwork,
    MocOptions,
    MocPipeSegment,
    ReservoirBC,
    SinglePipeMocInput,
    ValveBC,
    run_moc,
    run_moc_single_pipe,
)
from open_waterhammer.steady_network import (
    NetworkNodeDef,
    NetworkPipeDef,
    SteadyNetworkInput,
    calc_steady_network,
)

# ═══════════════════════════════════════════════════════════════════════════════
# 解析解ヘルパー（実装とは独立に、教科書の式から直接書き下したもの）
# ═══════════════════════════════════════════════════════════════════════════════


def hazen_williams_closed_form(length: float, q: float, c: float, d: float) -> float:
    """ヘーゼン・ウィリアムス式の閉形式（SI 単位・EPANET が内部で使う係数形）.

        hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.871)

    steady_network.py は V = 0.849·C·R^0.63·I^0.54 を I について解く形で実装
    しており、指数 1/0.54 = 1.85185… と 1.852 の差だけずれる（≈0.07%）。
    """
    return 10.67 * length * q**1.852 / (c**1.852 * d**4.871)


def allievi_chain(rho: float, taus: list[float]) -> list[float]:
    """アリエビ連鎖式 — 摩擦なし単一管路（貯水槽→バルブ）の**厳密解**.

        h_i + h_{i-1} = 2 + 2ρ(τ_{i-1}√h_{i-1} − τ_i√h_i)
        ρ = a·V₀/(2·g·H₀),  h = H/H₀,  h₀ = 1, τ₀ = 1

    t_i = i·(2L/a) におけるバルブ端水頭比 h を返す（Allievi 1903）。
    x = √h_i と置くと x² + 2ρτ_i·x − K = 0（K = 2 + 2ρτ_{i-1}√h_{i-1} − h_{i-1}）。
    """
    h = [1.0]
    for i in range(1, len(taus)):
        h_prev = h[i - 1]
        k = 2 + 2 * rho * (taus[i - 1] * math.sqrt(h_prev)) - h_prev
        b = 2 * rho * taus[i]
        x = (-b + math.sqrt(b * b + 4 * max(k, 0.0))) / 2
        h.append(x * x)
    return h


def rel_err_pct(actual: float, reference: float) -> float:
    return (actual / reference - 1) * 100


# ═══════════════════════════════════════════════════════════════════════════════
# S. 定常計算の検証
# ═══════════════════════════════════════════════════════════════════════════════


def single_pipe_steady(d, length, c, q, minor_loss_coeff=0.0):
    """単一管路（貯水槽 → 需要端）の定常計算."""
    return calc_steady_network(
        SteadyNetworkInput(
            pipes=[
                NetworkPipeDef(
                    id="p1",
                    upstream_node_id="R",
                    downstream_node_id="D",
                    inner_diameter=d,
                    length=length,
                    roughness_c=c,
                    minor_loss_coeff=minor_loss_coeff,
                )
            ],
            nodes=[
                NetworkNodeDef(id="R", elevation=0, type="reservoir", head=100),
                NetworkNodeDef(id="D", elevation=0, type="demand", demand=q),
            ],
        )
    )


class TestS1HazenWilliamsClosedForm:
    """S1 定常: ヘーゼン・ウィリアムス式が閉形式と一致する."""

    @pytest.mark.parametrize(
        ("d", "length", "c", "q"),
        [(0.30, 1000, 130, 0.10), (0.40, 500, 110, 0.20), (0.20, 2000, 150, 0.03), (0.60, 3000, 100, 0.50)],
    )
    def test_friction_matches_closed_form(self, d, length, c, q):
        hf = single_pipe_steady(d, length, c, q).pipe_results[0].friction_loss
        ref = hazen_williams_closed_form(length, q, c, d)
        err = abs(rel_err_pct(hf, ref))
        assert err < 0.5, f"hf={hf:.4f} m, 閉形式={ref:.4f} m, 誤差={err:.3f}%"

    def test_flow_doubling_exponent(self):
        """流量 2 倍で摩擦損失が 2^1.852 倍になる（H-W の指数則）."""
        hf1 = single_pipe_steady(0.3, 1000, 130, 0.05).pipe_results[0].friction_loss
        hf2 = single_pipe_steady(0.3, 1000, 130, 0.10).pipe_results[0].friction_loss
        err = abs(rel_err_pct(hf2 / hf1, 2**1.852))
        assert err < 0.5, f"比={hf2 / hf1:.4f}, 理論={2**1.852:.4f}, 誤差={err:.3f}%"

    def test_velocity_is_q_over_area(self):
        d, q = 0.35, 0.12
        v = single_pipe_steady(d, 800, 130, q).pipe_results[0].velocity
        assert v == pytest.approx(q / (math.pi * d * d / 4), abs=1e-12)


class TestS2EnergyBalance:
    """S2 定常: 直列管路のエネルギー収支."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="p1", upstream_node_id="R", downstream_node_id="N1", inner_diameter=0.40, length=600, roughness_c=130),
                    NetworkPipeDef(id="p2", upstream_node_id="N1", downstream_node_id="N2", inner_diameter=0.30, length=500, roughness_c=130, minor_loss_coeff=2),
                    NetworkPipeDef(id="p3", upstream_node_id="N2", downstream_node_id="D", inner_diameter=0.25, length=400, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R", elevation=0, type="reservoir", head=120),
                    NetworkNodeDef(id="N1", elevation=10, type="junction"),
                    NetworkNodeDef(id="N2", elevation=15, type="junction"),
                    NetworkNodeDef(id="D", elevation=20, type="demand", demand=0.08),
                ],
            )
        )

    def test_head_drop_equals_total_loss(self, result):
        h_r = next(n for n in result.node_results if n.node_id == "R").head
        h_d = next(n for n in result.node_results if n.node_id == "D").head
        sum_loss = sum(p.total_loss for p in result.pipe_results)
        assert (h_r - h_d) == pytest.approx(sum_loss, abs=1e-9)

    @pytest.mark.parametrize(("pipe_id", "d", "length"), [("p1", 0.40, 600), ("p2", 0.30, 500), ("p3", 0.25, 400)])
    def test_each_pipe_matches_closed_form(self, result, pipe_id, d, length):
        pr = next(p for p in result.pipe_results if p.pipe_id == pipe_id)
        ref = hazen_williams_closed_form(length, pr.flow, 130, d)
        err = abs(rel_err_pct(pr.friction_loss, ref))
        assert err < 0.5, f"{pipe_id}: hf={pr.friction_loss:.4f}, 閉形式={ref:.4f}, 誤差={err:.3f}%"

    def test_pressure_head_equals_head_minus_elevation(self, result):
        elev = {"R": 0, "N1": 10, "N2": 15, "D": 20}
        for n in result.node_results:
            assert n.pressure_head == pytest.approx(n.head - elev[n.node_id], abs=1e-12)


class TestS3TreeContinuity:
    """S3 定常: 樹枝状網の連続条件."""

    DEMANDS = {"D1": 0.040, "D2": 0.025, "D3": 0.015}

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="main", upstream_node_id="R", downstream_node_id="J1", inner_diameter=0.35, length=900, roughness_c=130),
                    NetworkPipeDef(id="b1", upstream_node_id="J1", downstream_node_id="D1", inner_diameter=0.25, length=400, roughness_c=130),
                    NetworkPipeDef(id="b2", upstream_node_id="J1", downstream_node_id="J2", inner_diameter=0.25, length=300, roughness_c=130),
                    NetworkPipeDef(id="b3", upstream_node_id="J2", downstream_node_id="D2", inner_diameter=0.20, length=350, roughness_c=130),
                    NetworkPipeDef(id="b4", upstream_node_id="J2", downstream_node_id="D3", inner_diameter=0.15, length=250, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R", elevation=0, type="reservoir", head=110),
                    NetworkNodeDef(id="J1", elevation=5, type="junction"),
                    NetworkNodeDef(id="J2", elevation=8, type="junction"),
                    NetworkNodeDef(id="D1", elevation=12, type="demand", demand=0.040),
                    NetworkNodeDef(id="D2", elevation=15, type="demand", demand=0.025),
                    NetworkNodeDef(id="D3", elevation=14, type="demand", demand=0.015),
                ],
            )
        )

    @staticmethod
    def _flow(result, pipe_id):
        return next(p for p in result.pipe_results if p.pipe_id == pipe_id).flow

    def test_main_flow_equals_total_demand(self, result):
        assert self._flow(result, "main") == pytest.approx(sum(self.DEMANDS.values()), abs=1e-12)

    def test_j1_continuity(self, result):
        assert self._flow(result, "main") == pytest.approx(self._flow(result, "b1") + self._flow(result, "b2"), abs=1e-12)

    def test_j2_continuity(self, result):
        assert self._flow(result, "b2") == pytest.approx(self._flow(result, "b3") + self._flow(result, "b4"), abs=1e-12)

    def test_terminal_head_equals_reservoir_minus_path_loss(self, result):
        h_r = next(n for n in result.node_results if n.node_id == "R").head
        loss = {p.pipe_id: p.total_loss for p in result.pipe_results}
        paths = {"D1": ["main", "b1"], "D2": ["main", "b2", "b3"], "D3": ["main", "b2", "b4"]}
        for node_id, path in paths.items():
            expected = h_r - sum(loss[pid] for pid in path)
            actual = next(n for n in result.node_results if n.node_id == node_id).head
            assert actual == pytest.approx(expected, abs=1e-9), node_id


class TestS4MinorLoss:
    """S4 定常: 局部損失が Σf·v²/2g と一致する."""

    def test_minor_loss_closed_form(self):
        d, q, k = 0.30, 0.10, 5
        pr = single_pipe_steady(d, 1000, 130, q, k).pipe_results[0]
        v = q / (math.pi * d * d / 4)
        assert pr.minor_loss == pytest.approx(k * v * v / (2 * GRAVITY), abs=1e-12)

    def test_zero_when_unspecified(self):
        assert single_pipe_steady(0.3, 1000, 130, 0.1).pipe_results[0].minor_loss == 0

    def test_total_is_sum(self):
        pr = single_pipe_steady(0.3, 1000, 130, 0.1, 3).pipe_results[0]
        assert pr.total_loss == pytest.approx(pr.friction_loss + pr.minor_loss, abs=1e-12)


class TestS5OutOfScopeTopology:
    """S5 定常【適用限界】前提を外れた入力.

    `calc_steady_network` は「樹枝状・単一貯水槽・需要は type="demand" ノード
    のみ」を前提とする。前提を外れた入力では別の系統を解いた答えを返すため、
    **閉路（ループ・複数貯水槽）は warnings で通知する**（例外は投げない）。
    正しい値は EPANET と突き合わせた
    packages/epanet-adapter/src/__tests__/steady-verification.test.ts を参照。

    ⚠ 数値そのものを固定している assert は特性化テストである。ソルバーが
       ループを解けるようになったら失敗するので、期待値を書き換えること。
    """

    def test_loop_network_drops_parallel_pipe_with_warning(self):
        r = calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="p1", upstream_node_id="R", downstream_node_id="J1", inner_diameter=0.30, length=500, roughness_c=130),
                    NetworkPipeDef(id="p2", upstream_node_id="J1", downstream_node_id="J2", inner_diameter=0.25, length=400, roughness_c=130),
                    NetworkPipeDef(id="p3", upstream_node_id="J1", downstream_node_id="J2", inner_diameter=0.25, length=600, roughness_c=130),
                    NetworkPipeDef(id="p4", upstream_node_id="J2", downstream_node_id="D", inner_diameter=0.30, length=300, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R", elevation=0, type="reservoir", head=100),
                    NetworkNodeDef(id="J1", elevation=0, type="junction"),
                    NetworkNodeDef(id="J2", elevation=0, type="junction"),
                    NetworkNodeDef(id="D", elevation=0, type="demand", demand=0.08),
                ],
            )
        )
        # 入力は管路 4 本だが結果は 3 本しか返らない（p3 が欠落）
        assert len(r.pipe_results) == 3, "ループ管 p3 が欠落していない = 実装が改善された"
        assert not [p for p in r.pipe_results if p.pipe_id == "p3"]
        # 分流されず p2 に全量が載る（EPANET は 0.0444 / 0.0356 に分流する）
        assert next(p for p in r.pipe_results if p.pipe_id == "p2").flow == pytest.approx(0.08, abs=1e-12)
        # 末端水頭は EPANET の 95.21 m に対し 92.46 m（-2.75 m の過小評価）
        h_d = next(n for n in r.node_results if n.node_id == "D").head
        assert h_d == pytest.approx(92.46, abs=0.05), f"H_D={h_d:.2f} m（EPANET 厳密解は 95.21 m）"
        # 結果は誤っているが、閉路検出の警告で利用者に通知される
        assert len(r.warnings) == 1, r.warnings
        assert "閉路（ループまたは複数貯水槽の並行流入）を検出しました: p3。" in r.warnings[0]
        assert "EPANET 経路で計算してください" in r.warnings[0]

    def test_no_false_positive_on_tree(self):
        """ループ検出は樹枝状網では誤検知しない."""
        r = calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="p1", upstream_node_id="R", downstream_node_id="J", inner_diameter=0.30, length=500, roughness_c=130),
                    NetworkPipeDef(id="p2", upstream_node_id="J", downstream_node_id="D1", inner_diameter=0.25, length=400, roughness_c=130),
                    NetworkPipeDef(id="p3", upstream_node_id="J", downstream_node_id="D2", inner_diameter=0.25, length=600, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R", elevation=0, type="reservoir", head=100),
                    NetworkNodeDef(id="J", elevation=0, type="junction"),
                    NetworkNodeDef(id="D1", elevation=0, type="demand", demand=0.05),
                    NetworkNodeDef(id="D2", elevation=0, type="demand", demand=0.03),
                ],
            )
        )
        assert len(r.pipe_results) == 3
        assert [w for w in r.warnings if "閉路" in w] == []

    def test_unreachable_island_is_not_reported_as_loop(self):
        """到達不能ノードに繋がる管路は閉路として誤報告しない."""
        r = calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="p1", upstream_node_id="R", downstream_node_id="D1", inner_diameter=0.30, length=500, roughness_c=130),
                    # 貯水槽から切り離された島
                    NetworkPipeDef(id="p2", upstream_node_id="X1", downstream_node_id="X2", inner_diameter=0.25, length=400, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R", elevation=0, type="reservoir", head=100),
                    NetworkNodeDef(id="D1", elevation=0, type="demand", demand=0.05),
                    NetworkNodeDef(id="X1", elevation=0, type="junction"),
                    NetworkNodeDef(id="X2", elevation=0, type="demand", demand=0.01),
                ],
            )
        )
        assert [w for w in r.warnings if "閉路" in w] == []
        assert len([w for w in r.warnings if "到達できません" in w]) == 2

    def test_junction_demand_is_still_ignored(self):
        """【未対応】type="junction" ノードの demand は依然として黙って無視される."""
        r = calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="p1", upstream_node_id="R", downstream_node_id="J", inner_diameter=0.30, length=500, roughness_c=130),
                    NetworkPipeDef(id="p2", upstream_node_id="J", downstream_node_id="D", inner_diameter=0.25, length=400, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R", elevation=0, type="reservoir", head=100),
                    NetworkNodeDef(id="J", elevation=0, type="junction", demand=0.05),
                    NetworkNodeDef(id="D", elevation=0, type="demand", demand=0.05),
                ],
            )
        )
        # 上流管の流量は 0.10 であるべきだが 0.05 になる
        assert next(p for p in r.pipe_results if p.pipe_id == "p1").flow == pytest.approx(0.05, abs=1e-12), (
            "junction の demand が集計された = 実装が改善された"
        )
        # 結果として節点水頭が危険側（高め）に出る（EPANET 厳密解は 96.79 m）
        h_j = next(n for n in r.node_results if n.node_id == "J").head
        assert h_j == pytest.approx(99.11, abs=0.05), f"H_J={h_j:.2f} m（EPANET 厳密解は 96.79 m）"
        # トポロジは樹枝状なので閉路検出には掛からず、警告なしのまま誤答する
        assert r.warnings == [], "junction の demand に警告が実装された = 実装が改善された"

    def test_second_reservoir_is_ignored_with_warning(self):
        r = calc_steady_network(
            SteadyNetworkInput(
                pipes=[
                    NetworkPipeDef(id="p1", upstream_node_id="R1", downstream_node_id="J", inner_diameter=0.30, length=500, roughness_c=130),
                    NetworkPipeDef(id="p2", upstream_node_id="R2", downstream_node_id="J", inner_diameter=0.30, length=500, roughness_c=130),
                    NetworkPipeDef(id="p3", upstream_node_id="J", downstream_node_id="D", inner_diameter=0.30, length=300, roughness_c=130),
                ],
                nodes=[
                    NetworkNodeDef(id="R1", elevation=0, type="reservoir", head=100),
                    NetworkNodeDef(id="R2", elevation=0, type="reservoir", head=95),
                    NetworkNodeDef(id="J", elevation=0, type="junction"),
                    NetworkNodeDef(id="D", elevation=0, type="demand", demand=0.10),
                ],
            )
        )
        # p2 が結果に現れない（EPANET は R2 へ -0.0238 m³/s の逆流を出す）
        assert not [p for p in r.pipe_results if p.pipe_id == "p2"], "2 つ目の貯水槽が扱われた = 実装が改善された"
        h_j = next(n for n in r.node_results if n.node_id == "J").head
        assert h_j == pytest.approx(96.78, abs=0.05), f"H_J={h_j:.2f} m（EPANET 厳密解は 95.23 m）"
        # 除外された管路と、貯水槽が複数ある事実の両方を通知する
        assert len(r.warnings) == 2, r.warnings
        assert "閉路（ループまたは複数貯水槽の並行流入）を検出しました: p2。" in r.warnings[0]
        assert "reservoir ノードが 2 個あります（R1, R2）。" in r.warnings[1]


# ═══════════════════════════════════════════════════════════════════════════════
# T. 非定常計算（MOC）の検証
# ═══════════════════════════════════════════════════════════════════════════════

BENCH_PIPE = Pipe(
    id="bench",
    start_node_id="upstream",
    end_node_id="downstream",
    pipe_type="steel",
    inner_diameter=0.5,
    wall_thickness=0.010,
    length=1200,
    roughness_coeff=130,
)
FRICTIONLESS_C = 1e6  # 摩擦を無視するための実質無限大の粗度係数

A_WAVE = 1000.0  # 波速 a [m/s]
V0 = 1.0  # 初期流速 [m/s]
H0 = 100.0  # バルブ端初期水頭 [m]
T_ROUND = 2 * BENCH_PIPE.length / A_WAVE  # 圧力波往復時間 2L/a = 2.4 s
T_PERIOD = 2 * T_ROUND  # 振動周期 4L/a = 4.8 s


def frictionless_valve_close(close_time, n_reaches, t_max):
    return run_moc_single_pipe(
        SinglePipeMocInput(
            pipe=replace(BENCH_PIPE, roughness_coeff=FRICTIONLESS_C),
            wave_speed=A_WAVE,
            initial_velocity=V0,
            initial_downstream_head=H0,
            close_time=close_time,
            n_reaches=n_reaches,
            t_max=t_max,
        )
    )


def head_at(series, t):
    """時系列 [{"t":…, "H":…}] から t に最も近い点の H を返す."""
    return min(series, key=lambda s: abs(s["t"] - t))["H"]


class TestT1Joukowsky:
    """T1 非定常: ジューコフスキーの式との一致（瞬時閉・摩擦なし）."""

    N = 40

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return frictionless_valve_close(0, cls.N, 4 * T_PERIOD)

    def test_theory_value(self):
        assert joukowsky(A_WAVE, -V0) == pytest.approx(A_WAVE * V0 / GRAVITY, abs=1e-12)

    def test_valve_head_rise_matches_joukowsky(self, result):
        dh = result.pipes["pipe_0"].Hmax[self.N] - H0
        err = abs(rel_err_pct(dh, joukowsky(A_WAVE, -V0)))
        assert err < 1.0, f"MOC ΔH={dh:.2f} m, 理論={joukowsky(A_WAVE, -V0):.2f} m, 誤差={err:.2f}%"

    def test_reservoir_head_is_fixed(self, result):
        p = result.pipes["pipe_0"]
        assert p.Hmax[0] == pytest.approx(p.H_steady[0], abs=1e-9)
        assert p.Hmin[0] == pytest.approx(p.H_steady[0], abs=1e-9)

    def test_square_wave_plateau(self, result):
        """閉そく直後の圧力上昇は矩形波（0 < t < 2L/a で一定）."""
        front = [s["H"] for s in result.nodes["downstream"].H if 0.15 * T_ROUND < s["t"] < 0.85 * T_ROUND]
        spread = max(front) - min(front)
        assert spread < 0.02 * joukowsky(A_WAVE, -V0), f"矩形波の平坦部のばらつき={spread:.3f} m"


class TestT2GridConvergence:
    """T2 非定常: 格子収束性."""

    @pytest.fixture(scope="class")
    @classmethod
    def peaks(cls):
        return {n: frictionless_valve_close(0, n, 4 * T_PERIOD).pipes["pipe_0"].Hmax[n] - H0 for n in (10, 20, 40, 80)}

    def test_all_within_1pct(self, peaks):
        for n, dh in peaks.items():
            err = abs(rel_err_pct(dh, joukowsky(A_WAVE, -V0)))
            assert err < 1.0, f"N={n}: ΔH={dh:.3f}, 誤差={err:.3f}%"

    def test_converged(self, peaks):
        err = abs(rel_err_pct(peaks[80], peaks[10]))
        assert err < 0.1, f"N=10 → N=80 の変化={err:.4f}%"


class TestT3WavePeriod:
    """T3 非定常: 圧力波の周期 4L/a と位相."""

    N = 40

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return frictionless_valve_close(0, cls.N, 2.5 * T_PERIOD)

    def test_vibration_period_recorded(self, result):
        assert result.pipes["pipe_0"].vibration_period == pytest.approx(T_PERIOD, abs=1e-9)

    @pytest.mark.parametrize("k", [0.25, 1.25, 2.25])
    def test_high_pressure_phase(self, result, k):
        h = head_at(result.nodes["downstream"].H, k * T_PERIOD)
        assert h > H0 + 1, f"t={k}T: H={h:.2f}"

    @pytest.mark.parametrize("k", [0.75, 1.75])
    def test_low_pressure_phase(self, result, k):
        h = head_at(result.nodes["downstream"].H, k * T_PERIOD)
        assert h < H0 - 1, f"t={k}T: H={h:.2f}"

    def test_returns_to_same_phase_after_one_period(self, result):
        series = result.nodes["downstream"].H
        first = head_at(series, 0.25 * T_PERIOD)
        second = head_at(series, 1.25 * T_PERIOD)
        assert abs(first - second) < 0.02 * (first - H0)


class TestT4SteadyStatePreservation:
    """T4 非定常: 操作がなければ定常解を厳密に維持する."""

    N = 12

    @pytest.fixture(scope="class")
    @classmethod
    def setup(cls):
        d, length, c = 0.5, 1200, 130
        q0 = V0 * math.pi * d * d / 4
        hf = single_pipe_steady(d, length, c, q0).pipe_results[0].friction_loss
        net = MocNetwork(
            pipes=[
                MocPipeSegment(
                    id="p1",
                    pipe=replace(BENCH_PIPE, inner_diameter=d, length=length, roughness_coeff=c),
                    wave_speed=A_WAVE,
                    n_reaches=cls.N,
                    upstream_node_id="R",
                    downstream_node_id="V",
                    initial_flow=q0,
                )
            ],
            # close_time を十分長くとることで τ ≒ 1（操作なし）とする
            nodes={"R": ReservoirBC(head=100), "V": ValveBC(Q0=q0, H0v=100 - hf, close_time=1e9)},
        )
        return hf, run_moc(net, MocOptions(t_max=30))

    def test_initial_condition_matches_steady_solver(self, setup):
        hf, result = setup
        p = result.pipes["p1"]
        hf_moc = p.H_steady[0] - p.H_steady[self.N]
        err = abs(rel_err_pct(hf_moc, hf))
        assert err < 1.0, f"MOC hf={hf_moc:.4f} m, 定常計算 hf={hf:.4f} m, 誤差={err:.3f}%"

    def test_no_drift_over_30s(self, setup):
        _, result = setup
        p = result.pipes["p1"]
        for i in range(self.N + 1):
            assert p.Hmax[i] == pytest.approx(p.H_steady[i], abs=1e-6), f"i={i} Hmax がドリフト"
            assert p.Hmin[i] == pytest.approx(p.H_steady[i], abs=1e-6), f"i={i} Hmin がドリフト"

    def test_valve_series_is_flat(self, setup):
        _, result = setup
        hs = [s["H"] for s in result.nodes["V"].H]
        assert max(hs) - min(hs) < 1e-6


class TestT5JunctionContinuity:
    """T5 非定常: 分岐点の連続条件と節点水頭の一意性."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        def mk(d, length):
            return replace(BENCH_PIPE, inner_diameter=d, length=length)

        net = MocNetwork(
            pipes=[
                MocPipeSegment(id="m", pipe=mk(0.40, 800), wave_speed=A_WAVE, n_reaches=8, upstream_node_id="R", downstream_node_id="J", initial_flow=0.16),
                MocPipeSegment(id="a", pipe=mk(0.30, 600), wave_speed=A_WAVE, n_reaches=6, upstream_node_id="J", downstream_node_id="VA", initial_flow=0.10),
                MocPipeSegment(id="b", pipe=mk(0.25, 400), wave_speed=A_WAVE, n_reaches=4, upstream_node_id="J", downstream_node_id="VB", initial_flow=0.06),
            ],
            nodes={
                "R": ReservoirBC(head=100),
                "VA": ValveBC(Q0=0.10, H0v=90, close_time=2),
                "VB": ValveBC(Q0=0.06, H0v=92, close_time=1e9),
            },
        )
        return run_moc(net, MocOptions(t_max=12))

    def test_flow_continuity(self, result):
        m, pa, pb = result.pipes["m"], result.pipes["a"], result.pipes["b"]
        max_err = max(
            abs(m.snapshots[k].Q[m.n_reaches] - pa.snapshots[k].Q[0] - pb.snapshots[k].Q[0])
            for k in range(len(m.snapshots))
        )
        assert max_err < 1e-12, f"分岐点の流量不釣り合い 最大 {max_err:.3e} m³/s"

    def test_head_uniqueness(self, result):
        m, pa, pb = result.pipes["m"], result.pipes["a"], result.pipes["b"]
        max_err = 0.0
        for k in range(len(m.snapshots)):
            h = m.snapshots[k].H[m.n_reaches]
            max_err = max(max_err, abs(h - pa.snapshots[k].H[0]), abs(h - pb.snapshots[k].H[0]))
        assert max_err < 1e-12, f"分岐点の水頭不一致 最大 {max_err:.3e} m"

    def test_surge_propagates_across_branch(self, result):
        pb = result.pipes["b"]
        assert pb.Hmax[pb.n_reaches] > 93, f"H_VB,max={pb.Hmax[pb.n_reaches]:.2f} m"


class TestT6TransmissionCoefficient:
    """T6 非定常: 断面変化点の透過係数 2B₁/(B₁+B₂).

    摩擦なし・上流 φ500 / 下流 φ300 の直列 2 管路、下流端で瞬時閉。
    下流管で立った ΔH = a·V₀/g が接合部に到達すると、上流管へは
    透過係数 2B₁/(B₁+B₂) 倍で伝わる（B = a/(g·A) は特性インピーダンス）。
    """

    D1, D2, L1, L2, V2 = 0.5, 0.3, 1000, 600, 1.0
    A1 = math.pi * D1**2 / 4
    A2 = math.pi * D2**2 / 4
    Q0 = V2 * A2
    B1 = A_WAVE / (GRAVITY * A1)
    B2 = A_WAVE / (GRAVITY * A2)
    T_ARRIVE = L2 / A_WAVE
    DH_JOUKOWSKY = A_WAVE * V2 / GRAVITY

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        def mk(d, length):
            return replace(BENCH_PIPE, inner_diameter=d, length=length, roughness_coeff=FRICTIONLESS_C)

        net = MocNetwork(
            pipes=[
                MocPipeSegment(id="up", pipe=mk(cls.D1, cls.L1), wave_speed=A_WAVE, n_reaches=10, upstream_node_id="R", downstream_node_id="C", initial_flow=cls.Q0),
                MocPipeSegment(id="dn", pipe=mk(cls.D2, cls.L2), wave_speed=A_WAVE, n_reaches=6, upstream_node_id="C", downstream_node_id="V", initial_flow=cls.Q0),
            ],
            nodes={"R": ReservoirBC(head=H0), "V": ValveBC(Q0=cls.Q0, H0v=H0, close_time=0)},
        )
        return run_moc(net, MocOptions(t_max=2.0))

    def test_valve_end_matches_joukowsky(self, result):
        hv = [s["H"] for s in result.nodes["V"].H if s["t"] < self.T_ARRIVE]
        err = abs(rel_err_pct(max(hv) - H0, self.DH_JOUKOWSKY))
        assert err < 1.0, f"ΔH_valve={max(hv) - H0:.2f}, 理論={self.DH_JOUKOWSKY:.2f}, 誤差={err:.2f}%"

    def test_junction_matches_transmission_coefficient(self, result):
        transmit = 2 * self.B1 / (self.B1 + self.B2)
        window = [s["H"] for s in result.nodes["C"].H if self.T_ARRIVE + 0.05 < s["t"] < self.T_ARRIVE + 0.40]
        dh_c = max(window) - H0
        ref = self.DH_JOUKOWSKY * transmit
        err = abs(rel_err_pct(dh_c, ref))
        assert err < 2.0, f"ΔH_C={dh_c:.2f} m, 理論={ref:.2f} m（透過係数={transmit:.4f}）, 誤差={err:.2f}%"

    def test_contraction_reduces_junction_surge(self, result):
        assert self.B2 > self.B1
        dh_c = max(s["H"] for s in result.nodes["C"].H) - H0
        assert dh_c < self.DH_JOUKOWSKY


class TestT7AllieviChain:
    """T7 非定常: アリエビ連鎖式（緩閉そくの厳密解）との一致."""

    RHO = A_WAVE * V0 / (2 * GRAVITY * H0)  # 管路特性値 ρ = a·V₀/(2gH₀)
    N = 60

    @staticmethod
    def _theory(n_t):
        tc = n_t * T_ROUND
        n_steps = n_t + 4
        taus = [max(0.0, 1 - (i * T_ROUND) / tc) for i in range(n_steps + 1)]
        return tc, n_steps, allievi_chain(TestT7AllieviChain.RHO, taus)

    # 閉そく時間を 2L/a の整数倍にとると、連鎖式の格子時刻と MOC の記録時刻が揃う
    @pytest.mark.parametrize("n_t", [2, 4, 6, 10])
    def test_peak_matches_exact_solution(self, n_t):
        tc, n_steps, h_theory = self._theory(n_t)
        result = frictionless_valve_close(tc, self.N, n_steps * T_ROUND)
        h_moc = result.pipes["pipe_0"].Hmax[self.N] / H0
        ref = max(h_theory)
        err = abs(rel_err_pct(h_moc, ref))
        assert err < 0.5, f"MOC h_max={h_moc:.4f}, アリエビ連鎖式={ref:.4f}, 誤差={err:.3f}%"

    @pytest.mark.parametrize("n_t", [2, 4, 6, 10])
    def test_each_interval_matches_exact_solution(self, n_t):
        tc, n_steps, h_theory = self._theory(n_t)
        result = frictionless_valve_close(tc, self.N, n_steps * T_ROUND)
        series = result.nodes["downstream"].H
        for i in range(1, len(h_theory)):
            h_moc = head_at(series, i * T_ROUND) / H0
            err = abs(rel_err_pct(h_moc, h_theory[i]))
            assert err < 1.0, f"i={i} (t={i * T_ROUND:.1f}s): MOC={h_moc:.4f}, 厳密解={h_theory[i]:.4f}, 誤差={err:.3f}%"

    def test_rapid_closure_boundary_equals_joukowsky(self):
        """tν = 2L/a（急閉そくの境界）ではジューコフスキー値に一致する."""
        result = frictionless_valve_close(T_ROUND, self.N, 4 * T_PERIOD)
        dh = result.pipes["pipe_0"].Hmax[self.N] - H0
        err = abs(rel_err_pct(dh, joukowsky(A_WAVE, -V0)))
        assert err < 2.0, f"ΔH={dh:.2f} m, ジューコフスキー={joukowsky(A_WAVE, -V0):.2f} m, 誤差={err:.2f}%"

    def test_longer_closure_monotonically_reduces_peak(self):
        peaks = [
            frictionless_valve_close(n_t * T_ROUND, self.N, (n_t + 4) * T_ROUND).pipes["pipe_0"].Hmax[self.N]
            for n_t in (2, 4, 6, 10)
        ]
        assert all(peaks[i] < peaks[i - 1] for i in range(1, len(peaks))), peaks


class TestT8FrictionDamping:
    """T8 非定常: 摩擦による減衰（エネルギー散逸の符号）."""

    N = 40

    @staticmethod
    def _amplitudes(series, cycles=10):
        out = []
        for c in range(cycles):
            win = [s["H"] for s in series if c * T_PERIOD <= s["t"] < (c + 1) * T_PERIOD]
            if len(win) >= 4:
                out.append(max(win) - min(win))
        return out

    @pytest.fixture(scope="class")
    @classmethod
    def rough(cls):
        result = run_moc_single_pipe(
            SinglePipeMocInput(
                pipe=BENCH_PIPE,
                wave_speed=A_WAVE,
                initial_velocity=V0,
                initial_downstream_head=H0,
                close_time=0,
                n_reaches=cls.N,
                t_max=10 * T_PERIOD,
            )
        )
        return cls._amplitudes(result.nodes["downstream"].H)

    @pytest.fixture(scope="class")
    @classmethod
    def smooth(cls):
        result = frictionless_valve_close(0, cls.N, 10 * T_PERIOD)
        return cls._amplitudes(result.nodes["downstream"].H)

    def test_enough_cycles(self, rough):
        assert len(rough) >= 8

    def test_monotonic_decay(self, rough):
        assert all(rough[i] <= rough[i - 1] + 1e-9 for i in range(1, len(rough))), rough

    def test_decays_below_80pct(self, rough):
        assert rough[-1] < 0.8 * rough[0], f"初期={rough[0]:.2f} → 最終={rough[-1]:.2f}"

    def test_smoother_pipe_decays_less(self, rough, smooth):
        assert smooth[-1] / smooth[0] > rough[-1] / rough[0]

    def test_friction_floor_leaves_residual_damping(self, smooth):
        """【実装特性】_local_darcy_f は等価ダルシー係数を max(0.005, min(…, 0.15)) で
        挟み込み、|V| < 1e-4 では 0.02 を返す。このため粗度係数 C をどれだけ
        大きくしても摩擦は完全には消えず、残留減衰が残る（解析解と比較する際は
        1〜2% 程度の系統誤差として見込む必要がある）。
        """
        ratio = smooth[-1] / smooth[0]
        assert ratio < 1.0, f"C=1e6 で全く減衰しない = 実装が変わった（残存率={ratio:.4f}）"
        assert ratio > 0.85, f"C=1e6 の 10 周期後残存率={ratio:.4f}（現状 ≈0.905）"


class TestT9CflCondition:
    """T9 非定常: CFL 条件 Δt = Δx/a."""

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        net = MocNetwork(
            pipes=[
                MocPipeSegment(id="p1", pipe=replace(BENCH_PIPE, length=1200), wave_speed=1000, n_reaches=12, upstream_node_id="R", downstream_node_id="J", initial_flow=0.1),
                MocPipeSegment(id="p2", pipe=replace(BENCH_PIPE, length=800, inner_diameter=0.3), wave_speed=800, n_reaches=10, upstream_node_id="J", downstream_node_id="V", initial_flow=0.1),
            ],
            nodes={"R": ReservoirBC(head=100), "V": ValveBC(Q0=0.1, H0v=95, close_time=1.5)},
        )
        return run_moc(net, MocOptions(t_max=8))

    def test_cfl_is_one(self, result):
        for pipe_id, p in result.pipes.items():
            cfl = p.dx / (p.wave_speed * result.dt)
            assert abs(cfl - 1) < 0.05, f"{pipe_id}: Δx/(a·Δt)={cfl:.4f}"

    def test_dx_is_length_over_reaches(self, result):
        assert result.pipes["p1"].dx == pytest.approx(1200 / result.pipes["p1"].n_reaches, abs=1e-9)
        assert result.pipes["p2"].dx == pytest.approx(800 / result.pipes["p2"].n_reaches, abs=1e-9)

    def test_dt_is_minimum(self, result):
        assert result.dt <= 1200 / (1000 * 12) + 1e-12
        assert result.dt <= 800 / (800 * 10) + 1e-12


class TestT10NegativeHeadClamp:
    """T10 非定常【適用限界】境界節点の負圧が 0 m で打ち切られる.

    摩擦なし・瞬時閉では理論上 Hmin = H₀ − a·V₀/g = 100 − 102.04 = −2.04 m。
    本ソルバーは水柱分離（キャビテーション）モデルを持たず、さらに境界条件
    ソルバー（バルブ・行き止まり・ポンプ等）が max(…, 0) で水頭を 0 m 以上に
    丸めるため、下降側の水撃圧が**過小評価（危険側）**になる。
    内部格子点にはクランプがないため負値自体は現れるが、境界の打ち切りが
    特性線を通じて内部にも伝わり、理論値までは下がらない。
    → 負圧が想定される系では §8.3 の防護工検討が別途必要。
    """

    N = 40
    H_THEORY_MIN = H0 - A_WAVE * V0 / GRAVITY  # = −2.04 m

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return frictionless_valve_close(0, cls.N, 4 * T_PERIOD)

    def test_theoretical_minimum_is_negative(self):
        assert self.H_THEORY_MIN < 0

    def test_valve_node_clamped_at_zero(self, result):
        hmin = result.pipes["pipe_0"].Hmin[self.N]
        assert hmin == pytest.approx(0.0, abs=1e-9), f"Hmin[valve]={hmin:.6f} m — 0 でない = 実装が変わった"

    def test_interior_goes_negative_but_truncated(self, result):
        interior_min = min(result.pipes["pipe_0"].Hmin[1 : self.N])
        assert interior_min < 0, f"内部 Hmin={interior_min:.4f} m（負値が出ない = 実装が変わった）"
        assert interior_min > self.H_THEORY_MIN / 2, (
            f"内部 Hmin={interior_min:.4f} m（理論={self.H_THEORY_MIN:.2f} m。現状 ≈-0.40 m まで打ち切られる）"
        )

    def test_no_clamp_when_head_is_high(self):
        """初期水頭が十分高くクランプが働かない場合は、下降側も理論値と 2% 以内で一致する."""
        result = run_moc_single_pipe(
            SinglePipeMocInput(
                pipe=replace(BENCH_PIPE, roughness_coeff=FRICTIONLESS_C),
                wave_speed=A_WAVE,
                initial_velocity=V0,
                initial_downstream_head=300,
                close_time=0,
                n_reaches=self.N,
                t_max=T_PERIOD,
            )
        )
        dh_down = 300 - result.pipes["pipe_0"].Hmin[self.N]
        err = abs(rel_err_pct(dh_down, joukowsky(A_WAVE, -V0)))
        # 残差 1.2% は T8 の「摩擦係数の下限」による系統誤差
        assert err < 2.0, f"ΔH_下降={dh_down:.2f} m, 理論={joukowsky(A_WAVE, -V0):.2f} m, 誤差={err:.2f}%"
