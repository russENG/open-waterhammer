"""formulas モジュールのテスト.

TypeScript 版 packages/core/src/__tests__/formulas.test.ts からの移植。
数値が一致することを保証する。
"""

import math
import re

import pytest

from open_waterhammer import (
    GRAVITY,
    Pipe,
    allievi_close,
    allievi_open,
    calc_allievi_k1,
    calc_empirical_waterhammer,
    calc_equivalent_length,
    calc_vibration_period,
    calc_wave_speed,
    determine_closure_type,
    head_to_mpa,
    joukowsky,
    mpa_to_head,
)

# ─── テスト用パイプ定義 ──────────────────────────────────────────────────────

# ダクタイル鋳鉄管 φ300mm × t7mm × L=500m（デモケース01と同条件）
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

# 硬質塩ビ管 φ200mm × t8mm × L=300m
PIPE_UPVC_200 = Pipe(
    id="p2",
    start_node_id="N1",
    end_node_id="N2",
    pipe_type="upvc",
    inner_diameter=0.200,
    wall_thickness=0.008,
    length=300,
    roughness_coeff=130,
)


# ─── 波速計算 ────────────────────────────────────────────────────────────────


class TestCalcWaveSpeed:
    def test_di300_in_typical_range(self) -> None:
        """ダクタイル鋳鉄管 φ300mm の波速はおよそ 1050〜1150 m/s の範囲内."""
        a = calc_wave_speed(PIPE_DI_300)
        assert 1050 < a < 1150, f"波速 = {a:.1f} m/s"

    def test_pvc_lower_than_di(self) -> None:
        """硬質塩ビ管は鋳鉄管より波速が低い（Eₛが小さいため）."""
        a_di = calc_wave_speed(PIPE_DI_300)
        a_pvc = calc_wave_speed(PIPE_UPVC_200)
        assert a_pvc < a_di, f"DI: {a_di:.0f}, PVC: {a_pvc:.0f}"

    def test_youngs_modulus_override(self) -> None:
        """ヤング係数を直接指定した場合は管種テーブルより優先される."""
        from dataclasses import replace

        pipe = replace(PIPE_DI_300, youngs_modulus=200e6)  # 鋼管と同じ値
        a_override = calc_wave_speed(pipe)
        a_di = calc_wave_speed(PIPE_DI_300)
        assert a_override > a_di, "鋼管Eₛ指定時は鋳鉄管より波速が高い"

    def test_smaller_c1_increases_wave_speed(self) -> None:
        """埋設状況係数 C₁ を小さくすると波速が上昇する."""
        from dataclasses import replace

        a_default = calc_wave_speed(PIPE_DI_300)
        a_small_c1 = calc_wave_speed(replace(PIPE_DI_300, c1_coeff=0.5))
        assert a_small_c1 > a_default


# ─── 圧力振動周期 ────────────────────────────────────────────────────────────


class TestCalcVibrationPeriod:
    def test_formula(self) -> None:
        """T₀ = 4L/a."""
        a = 1100
        length = 500
        t0 = calc_vibration_period(length, a)
        assert math.isclose(t0, (4 * length) / a, abs_tol=1e-10)


# ─── 急/緩閉そく判定 ─────────────────────────────────────────────────────────


class TestDetermineClosureType:
    def test_rapid_closure(self) -> None:
        """tν ≤ 2L/a → 急閉そく.

        L=500, a≈1100 → 2L/a ≈ 0.91s → tν=0.5s は急閉そく.
        """
        result = determine_closure_type(0.5, 500, 1100)
        assert result.closure_type == "rapid"

    def test_slow_closure(self) -> None:
        """tν > 2L/a かつ tν > L/300 → 緩閉そく.

        L=500, a=1100 → 2L/a≈0.91, L/300≈1.67 → tν=10s は緩閉そく.
        """
        result = determine_closure_type(10, 500, 1100)
        assert result.closure_type == "slow"

    def test_numerical_required(self) -> None:
        """tν > 2L/a かつ tν ≤ L/300 → numerical_required.

        L=500, a=1100 → 2L/a≈0.91s, L/300≈1.67s → tν=1.5s は中間域.
        """
        result = determine_closure_type(1.5, 500, 1100)
        assert result.closure_type == "numerical_required"

    def test_alpha_formula(self) -> None:
        """α値 = tν / T₀ = tν·a / (4L)（技術書 式8.2.6）."""
        a = 1000
        length = 500
        tv = 2.0
        result = determine_closure_type(tv, length, a)
        expected = (tv * a) / (4 * length)
        assert math.isclose(result.alpha, expected, abs_tol=1e-10)


# ─── ジューコフスキーの式 ─────────────────────────────────────────────────────


class TestJoukowsky:
    def test_close_operation_yields_positive_pressure_rise(self) -> None:
        """閉操作 (ΔV = -V₀) で正の水撃圧上昇.

        V₀=1.0 m/s, a=1100 m/s → ΔH ≈ 112 m.
        """
        d_h = joukowsky(1100, -1.0)
        assert d_h > 0, f"ΔH = {d_h:.1f} m"
        assert math.isclose(d_h, 1100 / GRAVITY, abs_tol=0.1)

    def test_open_operation_yields_negative_pressure(self) -> None:
        """開操作 (ΔV = +V₀) で負の圧力（低下）."""
        d_h = joukowsky(1100, 1.0)
        assert d_h < 0

    def test_zero_velocity_change_yields_zero(self) -> None:
        """流速変化ゼロなら水撃圧もゼロ."""
        # -0.0 == 0.0 は Python でも True
        assert joukowsky(1100, 0) == 0


# ─── アリエビの近似式 ─────────────────────────────────────────────────────────


class TestAllievi:
    def test_close_yields_positive_surge(self) -> None:
        """K₁ > 0 のとき surge > 0（圧力上昇）."""
        h0 = 30
        length = 500
        v = 1.0
        tv = 10
        k1 = calc_allievi_k1(length, v, h0, tv)
        hmax = allievi_close(h0, k1)
        assert hmax > 0, f"surge={hmax:.2f} > 0"
        assert hmax < h0, f"surge={hmax:.2f} < H₀={h0} (K₁<2のため)"

    def test_open_yields_negative(self) -> None:
        """Hmax_open は負値（圧力低下）."""
        h0 = 30
        length = 500
        v = 1.0
        tv = 10
        k1 = calc_allievi_k1(length, v, h0, tv)
        hmax_open = allievi_open(h0, k1)
        assert hmax_open < 0

    def test_close_match_formula(self) -> None:
        """技術書 式(8.3.7) と一致 (K₁=2 で Hmax/H₀ = 1+√3)."""
        # Hmax/H₀ = K₁/2 + √(K₁²/4 + K₁) = 1 + √3 ≈ 2.7321
        hmax = allievi_close(1, 2)
        assert math.isclose(hmax, 1 + math.sqrt(3), abs_tol=1e-9), f"Hmax={hmax}"

    def test_open_match_formula(self) -> None:
        """技術書 式(8.3.8) と一致 (K₁=2 で Hmax/H₀ = 1-√3)."""
        # Hmax/H₀ = K₁/2 - √(K₁²/4 + K₁) = 1 - √3 ≈ -0.7321
        hmax = allievi_open(1, 2)
        assert math.isclose(hmax, 1 - math.sqrt(3), abs_tol=1e-9), f"Hmax={hmax}"

    def test_longer_close_time_reduces_pressure(self) -> None:
        """閉そく時間を延ばすと K₁ が減り水撃圧が下がる."""
        h0 = 30
        length = 500
        v = 1.0
        k1_short = calc_allievi_k1(length, v, h0, 5)
        k1_long = calc_allievi_k1(length, v, h0, 20)
        assert k1_short > k1_long
        assert allievi_close(h0, k1_short) > allievi_close(h0, k1_long)


# ─── 等価管路長 ───────────────────────────────────────────────────────────────


class TestCalcEquivalentLength:
    def test_single_segment(self) -> None:
        """単一区間はそのまま."""
        length = calc_equivalent_length([{"length": 100, "area": 0.07}])
        assert math.isclose(length, 100, abs_tol=1e-10)

    def test_same_section_two_segments(self) -> None:
        """同断面2区間は合計延長."""
        length = calc_equivalent_length(
            [
                {"length": 100, "area": 0.07},
                {"length": 200, "area": 0.07},
            ]
        )
        assert math.isclose(length, 300, abs_tol=1e-10)

    def test_half_area_doubles_equivalent_length(self) -> None:
        """断面積が半分の区間は等価長が2倍になる."""
        # A₂ = A₁/2 → L₂の等価 = L₂ × (A₁/A₂) = L₂ × 2
        length = calc_equivalent_length(
            [
                {"length": 100, "area": 0.1},
                {"length": 100, "area": 0.05},
            ]
        )
        assert math.isclose(length, 300, abs_tol=1e-10), f"L = {length}"

    def test_empty_list_returns_zero(self) -> None:
        """空配列は 0."""
        assert calc_equivalent_length([]) == 0


# ─── 単位変換 ────────────────────────────────────────────────────────────────


class TestUnitConversion:
    def test_round_trip(self) -> None:
        """head_to_mpa → mpa_to_head は往復変換で元に戻る."""
        head = 100
        assert math.isclose(mpa_to_head(head_to_mpa(head)), head, abs_tol=1e-9)

    def test_100m_head_equals_098_mpa(self) -> None:
        """100m水頭 ≈ 0.98 MPa."""
        mpa = head_to_mpa(100)
        assert math.isclose(mpa, 0.98, abs_tol=0.001)


# ─── 経験則による水撃圧 ──────────────────────────────────────────────────────


class TestCalcEmpiricalWaterhammer:
    def test_open_type_20_percent(self) -> None:
        """オープンタイプ: 動水勾配線水圧 × 20%."""
        r = calc_empirical_waterhammer("gravity_open", 0.20, None, 0.30)
        assert math.isclose(r.waterhammer_mpa, 0.06, abs_tol=1e-9)

    def test_semi_closed_low_pressure(self) -> None:
        """セミ・クローズド 低圧: 静水圧 × 100%."""
        r = calc_empirical_waterhammer("gravity_semi_closed", 0.20)
        assert math.isclose(r.waterhammer_mpa, 0.20, abs_tol=1e-9)

    def test_semi_closed_high_40percent_dominant(self) -> None:
        """セミ・クローズド 高圧: max(静水圧×40%, 0.35MPa) — 40%側."""
        r = calc_empirical_waterhammer("gravity_semi_closed", 1.00)
        assert math.isclose(r.waterhammer_mpa, 0.40, abs_tol=1e-9)

    def test_semi_closed_high_floor_dominant(self) -> None:
        """セミ・クローズド 高圧: max(静水圧×40%, 0.35MPa) — 0.35側."""
        r = calc_empirical_waterhammer("gravity_semi_closed", 0.40)
        assert math.isclose(r.waterhammer_mpa, 0.35, abs_tol=1e-9)

    def test_closed_same_as_semi_closed(self) -> None:
        """クローズドタイプは セミ・クローズド と同じ式 (§8.3.5 a.②)."""
        # 低圧
        a1 = calc_empirical_waterhammer("gravity_closed", 0.20)
        b1 = calc_empirical_waterhammer("gravity_semi_closed", 0.20)
        assert a1.waterhammer_mpa == b1.waterhammer_mpa
        # 高圧 (40%側)
        a2 = calc_empirical_waterhammer("gravity_closed", 1.00)
        b2 = calc_empirical_waterhammer("gravity_semi_closed", 1.00)
        assert a2.waterhammer_mpa == b2.waterhammer_mpa
        # ラベルは区別されること
        assert re.search(r"クローズド", a1.rule)
        assert "セミ" not in a1.rule

    def test_distribution_tank_low(self) -> None:
        """配水槽方式 低圧: 通水圧 × 100%."""
        r = calc_empirical_waterhammer("pump_distribution_tank", 0.30, 0.30)
        assert math.isclose(r.waterhammer_mpa, 0.30, abs_tol=1e-9)

    def test_distribution_tank_high(self) -> None:
        """配水槽方式 高圧: max(通水圧×60%, 0.45MPa)."""
        r = calc_empirical_waterhammer("pump_distribution_tank", 0.50, 0.50)
        assert math.isclose(r.waterhammer_mpa, 0.45, abs_tol=1e-9)

    def test_pump_direct_low(self) -> None:
        """ポンプ直送 低圧: 静水圧 × 100%."""
        r = calc_empirical_waterhammer("pump_direct", 0.30)
        assert math.isclose(r.waterhammer_mpa, 0.30, abs_tol=1e-9)

    def test_pump_direct_high(self) -> None:
        """ポンプ直送 高圧: max(静水圧×60%, 0.45MPa)."""
        r = calc_empirical_waterhammer("pump_direct", 0.80)
        assert math.isclose(r.waterhammer_mpa, 0.48, abs_tol=1e-9), f"{r.waterhammer_mpa}"

    def test_pressure_tank_low(self) -> None:
        """圧力タンク 低圧: 静水圧 × 100%."""
        r = calc_empirical_waterhammer("pump_pressure_tank", 0.20)
        assert math.isclose(r.waterhammer_mpa, 0.20, abs_tol=1e-9)

    def test_pressure_tank_high(self) -> None:
        """圧力タンク 高圧: max(静水圧×40%, 0.35MPa)."""
        r = calc_empirical_waterhammer("pump_pressure_tank", 1.00)
        assert math.isclose(r.waterhammer_mpa, 0.40, abs_tol=1e-9)

    def test_warns_when_hgp_missing(self) -> None:
        """動水勾配線水圧未指定時は警告が出る."""
        r = calc_empirical_waterhammer("gravity_open", 0.20)
        assert len(r.warnings) > 0
