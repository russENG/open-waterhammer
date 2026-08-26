"""suggest_reaches — 計算区間数の自動提案（issue #49）.

MOC は全管路で共通の Δt を使うため、Δx = a·Δt が全管路で同時に成り立つ
分割数を選ぶ必要がある（技術書 §8.4.2(2)）。本テストは提案された分割数が
    - 実務目安 Δx = 50〜200 m に収まる（収まらない場合は理由を返す）
    - Courant 誤差が許容内
    - 実際に run_moc で例外なく完走する
ことを検証する。

TypeScript 版の対応ファイル:
    packages/core/src/__tests__/suggest-reaches.test.ts
"""

import pytest

from open_waterhammer import Pipe, calc_wave_speed
from open_waterhammer.moc import (
    MOC_GRID_SPACING_MAX,
    MOC_GRID_SPACING_RECOMMENDED_MIN,
    MocNetwork,
    MocOptions,
    MocPipeSegment,
    ReachCandidatePipe,
    ReservoirBC,
    ValveBC,
    run_moc,
    suggest_reaches,
)


def courant_error_of(pipes, reaches, dt):
    """提案された格子の Courant 誤差を独立に検算する."""
    return max(
        abs(p.length / n - p.wave_speed * dt) / (p.wave_speed * dt)
        for p, n in zip(pipes, reaches, strict=True)
    )


class TestSinglePipe:
    """単一管路."""

    PIPES = [ReachCandidatePipe(800, 1135)]

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return suggest_reaches(cls.PIPES)

    def test_courant_error_is_zero(self, result):
        """単一管路では Courant 誤差は常に 0."""
        assert result.courant_error < 1e-12

    def test_dx_within_practical_range(self, result):
        dx = 800 / result.reaches[0]
        assert MOC_GRID_SPACING_RECOMMENDED_MIN <= dx <= MOC_GRID_SPACING_MAX

    def test_dx_closest_to_target(self, result):
        """Δx が目標 125 m にもっとも近い分割を選ぶ."""
        dx = 800 / result.reaches[0]
        for n in range(4, 17):
            cand = 800 / n
            if cand < MOC_GRID_SPACING_RECOMMENDED_MIN or cand > MOC_GRID_SPACING_MAX:
                continue
            assert abs(dx - 125) <= abs(cand - 125) + 1e-9

    def test_dt_is_dx_over_a(self, result):
        assert result.dt == pytest.approx((800 / result.reaches[0]) / 1135, abs=1e-12)

    def test_no_warning_within_practical_range(self, result):
        assert result.warnings == []
        assert result.dx_min == MOC_GRID_SPACING_RECOMMENDED_MIN


class TestSeriesPipes:
    """直列 2 管路（波速が異なる）."""

    PIPES = [ReachCandidatePipe(1200, 1000), ReachCandidatePipe(800, 800)]

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return suggest_reaches(cls.PIPES)

    def test_courant_within_default_tolerance(self, result):
        assert result.courant_error <= 0.01

    def test_independent_recheck_matches(self, result):
        err = courant_error_of(self.PIPES, result.reaches, result.dt)
        assert err == pytest.approx(result.courant_error, abs=1e-12)

    def test_all_dx_within_range(self, result):
        for p, n in zip(self.PIPES, result.reaches, strict=True):
            dx = p.length / n
            assert result.dx_min <= dx <= MOC_GRID_SPACING_MAX


BRANCH_A = Pipe(
    id="a",
    start_node_id="J",
    end_node_id="VA",
    pipe_type="ductile_iron",
    inner_diameter=0.200,
    wall_thickness=0.0060,
    length=600,
    roughness_coeff=130,
)


class TestBranchedPipes:
    """分岐 3 管路（実務目安と両立しないケース）.

    examples/typical-cases.ts ケース G の諸元。
    Δx ≥ 50 m ではどの組み合わせでも Courant 誤差が収まらない。
    """

    PIPES = [
        ReachCandidatePipe(900, 1135),
        ReachCandidatePipe(600, calc_wave_speed(BRANCH_A)),
        ReachCandidatePipe(400, 1228),
    ]

    @pytest.fixture(scope="class")
    @classmethod
    def result(cls):
        return suggest_reaches(cls.PIPES)

    def test_dx_min_is_lowered(self, result):
        assert result.dx_min < MOC_GRID_SPACING_RECOMMENDED_MIN

    def test_reason_is_explained(self, result):
        assert len(result.warnings) == 1, result.warnings
        assert "実務目安の下限 50 m" in result.warnings[0]
        assert "Courant 誤差" in result.warnings[0]
        assert "§8.4.2(2)" in result.warnings[0]

    def test_courant_within_default_tolerance(self, result):
        assert result.courant_error <= 0.01

    def test_run_moc_completes_with_suggestion(self, result):
        def mk(pipe_id, d, t, length, frm, to):
            return Pipe(
                id=pipe_id, start_node_id=frm, end_node_id=to, pipe_type="ductile_iron",
                inner_diameter=d, wall_thickness=t, length=length, roughness_coeff=130,
            )

        segs = [
            MocPipeSegment(id="main", pipe=mk("main", 0.30, 0.0066, 900, "R", "J"), wave_speed=self.PIPES[0].wave_speed, n_reaches=result.reaches[0], upstream_node_id="R", downstream_node_id="J", initial_flow=0.065),
            MocPipeSegment(id="brA", pipe=BRANCH_A, wave_speed=self.PIPES[1].wave_speed, n_reaches=result.reaches[1], upstream_node_id="J", downstream_node_id="VA", initial_flow=0.045),
            MocPipeSegment(id="brB", pipe=mk("brB", 0.15, 0.0055, 400, "J", "VB"), wave_speed=self.PIPES[2].wave_speed, n_reaches=result.reaches[2], upstream_node_id="J", downstream_node_id="VB", initial_flow=0.020),
        ]
        res = run_moc(
            MocNetwork(
                pipes=segs,
                nodes={
                    "R": ReservoirBC(head=85),
                    "VA": ValveBC(Q0=0.045, H0v=76, close_time=2.0),
                    "VB": ValveBC(Q0=0.020, H0v=78, close_time=1e9),
                },
            ),
            MocOptions(t_max=20),
        )
        # 提案どおりの分割数が dt 整合化で変更されない（＝格子として整合している）
        for pipe_id, n in zip(("main", "brA", "brB"), result.reaches, strict=True):
            assert res.pipes[pipe_id].n_reaches == n, pipe_id
        assert res.dt == pytest.approx(result.dt, abs=1e-12)


class TestOptions:
    PIPES = [ReachCandidatePipe(1500, 1152)]

    def test_dx_target_shifts_selection(self):
        coarse = suggest_reaches(self.PIPES, dx_target=190)
        fine = suggest_reaches(self.PIPES, dx_target=55)
        assert 1500 / coarse.reaches[0] > 1500 / fine.reaches[0]

    def test_explicit_dx_min_disables_fallback(self):
        r = suggest_reaches(self.PIPES, dx_min=100)
        assert r.dx_min == 100
        assert 1500 / r.reaches[0] >= 100

    def test_no_solution_raises(self):
        with pytest.raises(ValueError, match="計算区間数の組が見つかりません"):
            suggest_reaches([ReachCandidatePipe(30, 1000)], dx_min=50, dx_max=200)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="管路が 0 本です"):
            suggest_reaches([])

    def test_non_positive_raises(self):
        with pytest.raises(ValueError, match="正の値"):
            suggest_reaches([ReachCandidatePipe(0, 1000)])
        with pytest.raises(ValueError, match="正の値"):
            suggest_reaches([ReachCandidatePipe(100, -1)])


class TestParityWithTypeScript:
    """TS 実装と同じ提案を返す（数値パリティ）."""

    def test_branch_case_matches_ts(self):
        r = suggest_reaches(
            [
                ReachCandidatePipe(900, 1135),
                ReachCandidatePipe(600, 1194),
                ReachCandidatePipe(400, 1228),
            ]
        )
        # TS 側 suggestReaches と同一の結果
        assert r.reaches == [22, 14, 9]
        assert r.dx_min == pytest.approx(35.0)
        assert r.courant_error == pytest.approx(0.008324, abs=1e-5)
