"""定常流計算（単管路）テスト."""

import math

from open_waterhammer.steady_flow import (
    calc_darcy_weisbach,
    calc_hazen_williams,
)


class TestDarcyWeisbach:
    def test_basic_formula(self):
        # D=0.3m, L=500m, Q=0.07065 m³/s (V=1.0 m/s), f=0.02
        # hf = 0.02 × (500/0.3) × (1²/19.6) = 1.700... m
        r = calc_darcy_weisbach(
            inner_diameter=0.3,
            length=500,
            flow_rate=0.07069,  # ~ V=1.0 with A=π×0.09/4
            upstream_elevation=100,
            downstream_elevation=98,
            friction_factor=0.02,
        )
        assert math.isclose(r.velocity, 1.0, abs_tol=0.01), f"V={r.velocity}"
        # hf = 0.02 × (500/0.3) × (1/19.6) ≈ 1.700
        expected_hf = 0.02 * (500 / 0.3) * (1.0 * 1.0 / (2 * 9.8))
        assert math.isclose(r.friction_loss, expected_hf, rel_tol=0.01)
        assert r.method == "darcy-weisbach"

    def test_low_velocity_warning(self):
        r = calc_darcy_weisbach(
            inner_diameter=1.0,  # large diameter → low velocity
            length=500,
            flow_rate=0.1,
            upstream_elevation=100,
            downstream_elevation=98,
            friction_factor=0.02,
        )
        assert any("下限" in w for w in r.warnings)

    def test_elevation_diff(self):
        r = calc_darcy_weisbach(
            inner_diameter=0.3,
            length=500,
            flow_rate=0.07069,
            upstream_elevation=100,
            downstream_elevation=95,
            friction_factor=0.02,
        )
        assert r.elevation_diff == -5  # 下流 - 上流


class TestHazenWilliams:
    def test_basic_formula(self):
        # 公式帳票例的: D=0.6, C=130, V≈1.6, I≈3.6‰
        d = 0.6
        c = 130
        v_target = 1.597
        area = math.pi * d * d / 4
        q = v_target * area
        r = calc_hazen_williams(
            inner_diameter=d,
            length=100,
            flow_rate=q,
            upstream_elevation=100,
            downstream_elevation=99,
            roughness_c=c,
        )
        assert math.isclose(r.velocity, v_target, abs_tol=0.01)
        # 動水勾配 ≈ 3.62‰
        assert abs(r.hydraulic_gradient * 1000 - 3.62) < 0.05

    def test_method_label(self):
        r = calc_hazen_williams(
            inner_diameter=0.3,
            length=500,
            flow_rate=0.07069,
            upstream_elevation=100,
            downstream_elevation=98,
            roughness_c=130,
        )
        assert r.method == "hazen-williams"

    def test_high_velocity_warning(self):
        # 小径×大流量 → 高流速
        r = calc_hazen_williams(
            inner_diameter=0.1,
            length=500,
            flow_rate=0.05,
            upstream_elevation=100,
            downstream_elevation=98,
            roughness_c=130,
        )
        assert any("上限" in w for w in r.warnings)
