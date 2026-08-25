"""縦断水理計算テスト.

公式帳票の計算例（MAFF成果品様式）と照合.
"""

import math

from open_waterhammer import GRAVITY, MeasurementPoint
from open_waterhammer.longitudinal_hydraulic import (
    calc_longitudinal_hydraulic,
    calc_minor_loss,
    calc_segment_friction,
    calc_total_loss_coeff,
)
from open_waterhammer.types import LongitudinalHydraulicInput


# ─── 局部損失計算 ────────────────────────────────────────────────────────────


class TestMinorLoss:
    def test_total_loss_coeff_sums(self):
        pt = MeasurementPoint(
            id="IP.161",
            horizontal_distance=25.776,
            ground_level=477.20,
            pipe_center_height=475.533,
            pipe_length=25.874,
            flow_rate=0.4515,
            diameter=0.6,
            roughness_c=130,
            bend_loss_coeff=0.022,
            valve_loss_coeff=0,
            branch_loss_coeff=0,
        )
        assert math.isclose(calc_total_loss_coeff(pt), 0.022, abs_tol=1e-10)

    def test_minor_loss_no_other(self):
        hv = 1.597 * 1.597 / (2 * GRAVITY)  # ≈ 0.130
        loss = calc_minor_loss(0.022, hv, 0)
        assert math.isclose(loss, 0.022 * hv, abs_tol=1e-6)

    def test_minor_loss_with_other(self):
        hv = 0.130
        loss = calc_minor_loss(0.05, hv, 0.01)
        assert math.isclose(loss, 0.05 * 0.130 + 0.01, abs_tol=1e-6)


# ─── 摩擦損失計算 ────────────────────────────────────────────────────────────


class TestSegmentFriction:
    def test_phi600_c130(self):
        # 公式帳票の例: φ600, C=130, V≈1.597, 動水勾配≈3.6215‰
        d = 0.6
        c = 130
        # Q = 0.4515 m³/s → V = Q / (π/4 × 0.6²) ≈ 1.597
        v = 0.4515 / (math.pi * d * d / 4)
        i_grad, hf = calc_segment_friction(d, c, v, 25.874)

        assert abs(i_grad * 1000 - 3.6215) < 0.05, (
            f"動水勾配 {i_grad * 1000:.4f}‰ ≈ 3.6215‰"
        )
        assert 0.08 < hf < 0.12, f"摩擦損失 {hf:.4f} m"


# ─── 縦断水理計算 ────────────────────────────────────────────────────────────


def make_test_points() -> list[MeasurementPoint]:
    """公式帳票例の最初の3測点（φ600, C=130, Q=451.50L/s）."""
    return [
        MeasurementPoint(
            id="IP.161",
            horizontal_distance=25.776,
            ground_level=477.20,
            pipe_center_height=475.533,
            pipe_length=25.874,
            flow_rate=0.4515,
            diameter=0.6,
            roughness_c=130,
            bend_loss_coeff=0.022,
            valve_loss_coeff=0,
            branch_loss_coeff=0,
        ),
        MeasurementPoint(
            id="IP.162",
            horizontal_distance=9.000,
            ground_level=478.01,
            pipe_center_height=476.402,
            pipe_length=9.033,
            flow_rate=0.4515,
            diameter=0.6,
            roughness_c=130,
            bend_loss_coeff=0.043,
            valve_loss_coeff=0,
            branch_loss_coeff=0,
        ),
        MeasurementPoint(
            id="IP.163",
            horizontal_distance=7.583,
            ground_level=478.71,
            pipe_center_height=477.050,
            pipe_length=7.611,
            flow_rate=0.4515,
            diameter=0.6,
            roughness_c=130,
            bend_loss_coeff=0.049,
            valve_loss_coeff=0,
            branch_loss_coeff=0,
        ),
    ]


class TestLongitudinalCalc:
    def test_energy_level_decreases_downstream(self):
        result = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=make_test_points(),
                static_water_level=563.0,
                waterhammer_pressure_mpa=0.41,
                case_name="計画最大流量",
            )
        )

        assert result.case_name == "計画最大流量"
        assert len(result.point_results) == 3

        # エネルギー標高は順次低下
        els = [r.energy_level for r in result.point_results]
        assert els[0] > els[1], "EL[0] > EL[1]"
        assert els[1] > els[2], "EL[1] > EL[2]"

        # 動水位もエネルギー標高以下
        for r in result.point_results:
            assert r.hydraulic_grade_line <= r.energy_level

    def test_design_pressure_equals_static_plus_waterhammer(self):
        result = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=make_test_points(),
                static_water_level=563.0,
                waterhammer_pressure_mpa=0.41,
            )
        )

        for r in result.point_results:
            assert math.isclose(
                r.design_pressure,
                r.static_pressure + r.waterhammer_pressure,
                abs_tol=1e-6,
            )

    def test_waterhammer_ratio_mode(self):
        result = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=make_test_points(),
                static_water_level=563.0,
                waterhammer_ratio=0.4,
            )
        )

        for r in result.point_results:
            assert math.isclose(
                r.waterhammer_pressure, r.static_pressure * 0.4, abs_tol=1e-6
            )

    def test_empty_points_warns(self):
        result = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=[],
                static_water_level=563.0,
            )
        )
        assert len(result.point_results) == 0
        assert len(result.warnings) > 0

    def test_official_form_ip161_matches(self):
        # 帳票例: IP.161 の EL=562.909, 全損失≈0.100
        result = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=make_test_points()[:1],
                static_water_level=563.009,
                waterhammer_pressure_mpa=0.41,
            )
        )
        r = result.point_results[0]

        assert abs(r.energy_level - 562.909) < 0.1, f"EL {r.energy_level:.3f} ≈ 562.909"
        assert abs(r.total_loss - 0.100) < 0.01, f"全損失 {r.total_loss:.4f} ≈ 0.100"
        assert math.isclose(
            r.design_pressure,
            r.static_pressure + r.waterhammer_pressure,
            abs_tol=1e-6,
        )


# ─── 負圧区間の扱い (#40) ────────────────────────────────────────────────────


class TestNegativeStaticPressure:
    """静水圧が0以下の測点では、比例算定の水撃圧・設計内圧を出さない."""

    def _run(self, **kwargs):
        # 静水位を管中心高より低く置き、全測点を負圧にする。
        return calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=make_test_points(),
                static_water_level=400.0,
                **kwargs,
            )
        )

    def test_default_ratio_yields_none_instead_of_negative(self):
        result = self._run()
        assert all(r.pressure_head < 0 for r in result.point_results)
        assert all(r.waterhammer_pressure is None for r in result.point_results)
        assert all(r.design_pressure is None for r in result.point_results)
        assert result.max_design_pressure == 0

    def test_explicit_ratio_also_skipped(self):
        result = self._run(waterhammer_ratio=0.4)
        assert all(r.waterhammer_pressure is None for r in result.point_results)

    def test_explicit_mpa_is_kept(self):
        # 絶対値指定は設計者が明示した値なので、静水圧の符号によらず使う。
        result = self._run(waterhammer_pressure_mpa=0.41)
        for r in result.point_results:
            assert r.waterhammer_pressure == 0.41
            assert math.isclose(
                r.design_pressure, r.static_pressure + 0.41, abs_tol=1e-12
            )

    def test_warning_is_emitted_once(self):
        result = self._run()
        matching = [w for w in result.warnings if "静水圧が0以下の測点" in w]
        assert len(matching) == 1


class TestWarningsAreSummarised:
    """31測点あっても、同種の警告は1行にまとめる (#40 と併せた読みやすさ改善)."""

    def test_velocity_and_negative_head_warnings_are_single_lines(self):
        result = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=make_test_points(),
                static_water_level=400.0,
            )
        )
        assert len([w for w in result.warnings if "推奨上限" in w]) <= 1
        assert len([w for w in result.warnings if "推奨下限" in w]) <= 1
        assert len([w for w in result.warnings if "負圧" in w]) == 1
