"""簡易式計算（ジューコフスキー / アリエビ）テスト."""

from open_waterhammer import (
    CalculationCase,
    Pipe,
)
from open_waterhammer.simple_calculation import run_simple_formula


# ─── テスト用パイプ ─────────────────────────────────────────────────────────

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


def make_case(velocity: float = 1.0, head: float = 30.0) -> CalculationCase:
    return CalculationCase(
        id="c1",
        name="テスト",
        operation_type="valve_close",
        target_facility_id="v1",
        initial_velocity=velocity,
        initial_head=head,
    )


class TestRapidClosure:
    def test_rapid_uses_joukowsky(self):
        # 急閉そく: tν=0.1s → α≈0.055 < 0.5 → rapid
        result = run_simple_formula(PIPE_DI_300, make_case(), close_time=0.1)
        assert result.closure_type == "rapid"
        assert result.delta_h_joukowsky is not None
        assert result.delta_h_joukowsky > 0
        # 緩閉そく系の値は出ない
        assert result.k1 is None
        assert result.hmax_allievi_close is None

    def test_rapid_no_warnings_for_normal_case(self):
        result = run_simple_formula(PIPE_DI_300, make_case(), close_time=0.1)
        # 通常ケースでは警告なし
        critical_warnings = [w for w in result.warnings if "数値解析が必要" in w]
        assert len(critical_warnings) == 0


class TestSlowClosure:
    def test_slow_uses_allievi(self):
        # 緩閉そく: tν=10s, L=500, a≈1100 → α=tν/T0=10/(4*500/1100)≈5.5 > 0.5
        result = run_simple_formula(PIPE_DI_300, make_case(), close_time=10.0)
        assert result.closure_type == "slow"
        assert result.k1 is not None
        assert result.hmax_allievi_close is not None
        assert result.hmax_allievi_open is not None
        assert result.allievi_applicable is True
        # 急閉そく系の値は出ない
        assert result.delta_h_joukowsky is None


class TestNumericalRequired:
    def test_numerical_required_warns(self):
        # tν > 2L/a だが tν ≤ L/300 → numerical_required
        # L=500, a≈1100 → 2L/a≈0.91, L/300≈1.67 → tν=1.5s
        result = run_simple_formula(PIPE_DI_300, make_case(), close_time=1.5)
        assert result.closure_type == "numerical_required"
        assert any("数値解析が必要" in w for w in result.warnings)


class TestWaveSpeedResult:
    def test_wave_speed_in_result(self):
        result = run_simple_formula(PIPE_DI_300, make_case(), close_time=0.5)
        assert result.wave_speed.wave_speed > 1000
        assert result.wave_speed.vibration_period > 0
        assert result.wave_speed.alpha > 0
