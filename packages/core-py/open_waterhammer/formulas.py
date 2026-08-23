"""水撃圧計算 基礎式.

出典: 土地改良設計基準パイプライン技術書 第8章

各関数は入力・出力・適用条件を明示し、
適用範囲外の場合はエラーまたは警告を返す。
"""

import math

from .pipe_materials import PIPE_MATERIALS
from .types import (
    ClosureDetermination,
    EmpiricalWaterhammerResult,
    JudgementResult,
    JudgementStatus,
    Pipe,
    PipelineSystemType,
    WaveSpeedResult,
)

# ─── 物理定数 ─────────────────────────────────────────────────────────────────

# 重力加速度 [m/s²].
# 技術書 §8 では 9.8 m/s² を採用している（9.81 ではない）。
GRAVITY: float = 9.8

# 水の体積弾性係数 K [kN/m²]（基準書既定値）.
BULK_MODULUS_WATER: float = 2.03e6

# 水の単位体積重量 w₀ [kN/m³].
WATER_UNIT_WEIGHT: float = 9.8


# ─── 波速計算 ─────────────────────────────────────────────────────────────────


def calc_wave_speed(pipe: Pipe) -> float:
    """波速算定 (式 8.2.4).

    a = 1 / √( w₀/g × (1/K + D·C₁/(Eₛ·t)) )

    Args:
        pipe: 管路情報.

    Returns:
        波速 a [m/s].
    """
    es = (
        pipe.youngs_modulus
        if pipe.youngs_modulus is not None
        else PIPE_MATERIALS[pipe.pipe_type].youngs_modulus_short
    )
    c1 = pipe.c1_coeff if pipe.c1_coeff is not None else 1.0
    d = pipe.inner_diameter
    t = pipe.wall_thickness

    term = (WATER_UNIT_WEIGHT / GRAVITY) * (1 / BULK_MODULUS_WATER + (d * c1) / (es * t))
    return 1 / math.sqrt(term)


def calc_vibration_period(pipe_length: float, wave_speed: float) -> float:
    """圧力振動周期 T₀ (式 8.2.5).

    T₀ = 4L / a
    """
    return (4 * pipe_length) / wave_speed


def determine_closure_type(
    close_time: float,
    pipe_length: float,
    wave_speed: float,
) -> ClosureDetermination:
    """急/緩閉そく判定 + α値.

    技術書 式(8.2.6): α = t₀ / T₀ （T₀ = 4L/a）.
    物理的判定: tν ≤ 2L/a で急閉そく（往復時間内に操作が完了）
              ⇔ α ≤ 0.5

    Args:
        close_time: 等価閉そく時間 tν [s].
        pipe_length: 管路延長 L [m].
        wave_speed: 波速 a [m/s].
    """
    t0 = (4 * pipe_length) / wave_speed
    alpha = close_time / t0  # 技術書 式(8.2.6)

    if alpha <= 0.5:
        return ClosureDetermination(closure_type="rapid", alpha=alpha)
    # tν > L/300 でない場合は数値解析が必要
    if close_time <= pipe_length / 300:
        return ClosureDetermination(closure_type="numerical_required", alpha=alpha)
    return ClosureDetermination(closure_type="slow", alpha=alpha)


def calc_wave_speed_result(pipe: Pipe, close_time: float) -> WaveSpeedResult:
    """波速計算結果をまとめて返す."""
    a = calc_wave_speed(pipe)
    t0 = calc_vibration_period(pipe.length, a)
    # α = t₀/T₀ (ここでは t₀ = close_time で近似)
    alpha = close_time / t0
    return WaveSpeedResult(wave_speed=a, vibration_period=t0, alpha=alpha)


# ─── ジューコフスキーの式 ─────────────────────────────────────────────────────


def joukowsky(wave_speed: float, delta_v: float) -> float:
    """ジューコフスキーの式 (式 8.3.6) — 急閉そく.

    ΔH = -(a / g) × ΔV

    適用条件: tν ≤ 2L/a（急閉そく）

    Args:
        wave_speed: 波速 a [m/s].
        delta_v: 流速変化 ΔV [m/s]（閉そくなら -V₀）.

    Returns:
        圧力上昇水頭 ΔH [m]（正で上昇、負で低下）.
    """
    return -(wave_speed / GRAVITY) * delta_v


# ─── アリエビの近似式 ─────────────────────────────────────────────────────────


def calc_allievi_k1(
    pipe_length: float,
    velocity: float,
    static_head: float,
    close_time: float,
) -> float:
    """アリエビ式 K₁ 算定.

    K₁ = (L·V) / (g·H₀·tν)
    技術書 式(8.3.7) 直下の定義に従う.
    """
    return (pipe_length * velocity) / (GRAVITY * static_head * close_time)


def allievi_close(static_head: float, k1: float) -> float:
    """アリエビの近似式（閉操作時最大水撃圧）(式 8.3.7).

    Hmax/H₀ = K₁/2 + √(K₁²/4 + K₁)

    適用条件: tν > 2L/a かつ tν > L/300

    Args:
        static_head: H₀ [m].
        k1: K₁ 値.

    Returns:
        最大水撃圧水頭 Hmax [m].
    """
    return static_head * (k1 / 2 + math.sqrt((k1 * k1) / 4 + k1))


def allievi_open(static_head: float, k1: float) -> float:
    """アリエビの近似式（開操作時最大圧力低下）(式 8.3.8).

    Hmax = H₀/2 × (K₁ - √(K₁² + 4))

    Args:
        static_head: H₀ [m].
        k1: K₁ 値.

    Returns:
        最大圧力低下水頭 Hmax [m]（負値）.
    """
    return static_head * (k1 / 2 - math.sqrt((k1 * k1) / 4 + k1))


# ─── 多段口径管路の等価管路長 ────────────────────────────────────────────────


def calc_equivalent_length(segments: list[dict[str, float]]) -> float:
    """多段口径管路の等価管路長 (式 8.3.9).

    L = L₁ + L₂·(A₁/A₂) + L₃·(A₁/A₃) + ...

    Args:
        segments: 各区間 [{"length": L [m], "area": A [m²]}, ...].

    Returns:
        等価管路長 L [m].
    """
    if len(segments) == 0:
        return 0
    base_area = segments[0]["area"]
    return sum(seg["length"] * (base_area / seg["area"]) for seg in segments)


# ─── 設計水圧 ─────────────────────────────────────────────────────────────────


def calc_design_pressure(
    static_pressure_mpa: float,
    waterhammer_pressure_mpa: float,
) -> float:
    """設計水圧 = 静水圧 + 水撃圧 (式 8.3.2)."""
    return static_pressure_mpa + waterhammer_pressure_mpa


# ─── 耐圧判定 ─────────────────────────────────────────────────────────────────


def judge_design_pressure(
    design_pressure_mpa: float,
    allowable_pressure_mpa: float,
) -> JudgementResult:
    """設計水圧と許容圧力を比較し判定する.

    判定基準:
        OK      : 設計水圧 ≤ 許容圧力 × 0.9（余裕度 ≥ 10%）
        WARNING : 設計水圧 ≤ 許容圧力（余裕度 < 10%）
        NG      : 設計水圧 > 許容圧力
    """
    margin = (allowable_pressure_mpa - design_pressure_mpa) / allowable_pressure_mpa

    status: JudgementStatus
    message: str

    if design_pressure_mpa > allowable_pressure_mpa:
        status = "ng"
        message = (
            f"設計水圧 {design_pressure_mpa:.3f} MPa が許容圧力 "
            f"{allowable_pressure_mpa:.3f} MPa を超過しています。"
            "管種・管厚・防護施設を見直してください。"
        )
    elif margin < 0.1:
        status = "warning"
        message = (
            "設計水圧が許容圧力の 90% 超です"
            f"（余裕度 {margin * 100:.1f}%）。詳細検討を推奨します。"
        )
    else:
        status = "ok"
        message = (
            f"設計水圧 {design_pressure_mpa:.3f} MPa ≤ 許容圧力 "
            f"{allowable_pressure_mpa:.3f} MPa（余裕度 {margin * 100:.1f}%）"
        )

    return JudgementResult(
        status=status,
        design_pressure_mpa=design_pressure_mpa,
        allowable_pressure_mpa=allowable_pressure_mpa,
        margin=margin,
        message=message,
    )


# ─── 経験則による水撃圧 ──────────────────────────────────────────────────────


def calc_empirical_waterhammer(
    system_type: PipelineSystemType,
    static_pressure_mpa: float,
    operating_pressure_mpa: float | None = None,
    hydraulic_grade_pressure_mpa: float | None = None,
) -> EmpiricalWaterhammerResult:
    """経験則による水撃圧算定 (技術書 8.3.5節).

    適用範囲: 給水栓を有する水田用配水系パイプラインで
        静水圧 0.35MPa 未満、またはオープンタイプの場合のみ推奨。
        その他の場合は計算による方法（ジューコフスキー/アリエビ）を原則とする。

    Args:
        system_type: パイプライン系統の方式区分.
        static_pressure_mpa: 静水圧 [MPa]
            （自然圧送・ポンプ直送・圧力タンク方式で使用）.
        operating_pressure_mpa: 通水時水圧（動水圧）[MPa]
            （配水槽方式で使用）.
        hydraulic_grade_pressure_mpa: 動水勾配線水圧 [MPa]
            （オープンタイプで使用）.
    """
    warnings: list[str] = []
    waterhammer_mpa: float
    rule: str

    match system_type:
        # ── 自然圧送 オープンタイプ ─────────────────────────────────────────
        case "gravity_open":
            hgp = (
                hydraulic_grade_pressure_mpa
                if hydraulic_grade_pressure_mpa is not None
                else static_pressure_mpa
            )
            if hydraulic_grade_pressure_mpa is None:
                warnings.append(
                    "動水勾配線水圧が未指定のため静水圧で代用しています。"
                    "正確な計算には動水勾配線水圧を入力してください。"
                )
            waterhammer_mpa = hgp * 0.20
            rule = (
                f"オープンタイプ: 動水勾配線水圧 {hgp:.3f} MPa × 20% = "
                f"{waterhammer_mpa:.3f} MPa"
            )

        # ── 自然圧送 クローズド / セミ・クローズドタイプ ────────────────────
        # §8.3.5 a.② は両タイプを同一式で扱う
        case "gravity_closed" | "gravity_semi_closed":
            type_label = "クローズド" if system_type == "gravity_closed" else "セミ・クローズド"
            if static_pressure_mpa < 0.35:
                waterhammer_mpa = static_pressure_mpa * 1.0
                rule = (
                    f"{type_label}（静水圧 < 0.35MPa）: 静水圧 "
                    f"{static_pressure_mpa:.3f} MPa × 100% = {waterhammer_mpa:.3f} MPa"
                )
            else:
                waterhammer_mpa = max(static_pressure_mpa * 0.40, 0.35)
                rule = (
                    f"{type_label}（静水圧 ≥ 0.35MPa）: max("
                    f"{static_pressure_mpa:.3f} × 40%, 0.35) = "
                    f"{waterhammer_mpa:.3f} MPa"
                )

        # ── ポンプ系 配水槽方式 ─────────────────────────────────────────────
        case "pump_distribution_tank":
            op = operating_pressure_mpa if operating_pressure_mpa is not None else static_pressure_mpa
            if operating_pressure_mpa is None:
                warnings.append("通水時水圧（動水圧）が未指定のため静水圧で代用しています。")
            if op < 0.45:
                waterhammer_mpa = op * 1.0
                rule = (
                    f"配水槽方式（通水圧 < 0.45MPa）: 通水圧 "
                    f"{op:.3f} MPa × 100% = {waterhammer_mpa:.3f} MPa"
                )
            else:
                waterhammer_mpa = max(op * 0.60, 0.45)
                rule = (
                    f"配水槽方式（通水圧 ≥ 0.45MPa）: max("
                    f"{op:.3f} × 60%, 0.45) = {waterhammer_mpa:.3f} MPa"
                )

        # ── ポンプ系 直送方式 ───────────────────────────────────────────────
        case "pump_direct":
            if static_pressure_mpa < 0.45:
                waterhammer_mpa = static_pressure_mpa * 1.0
                rule = (
                    f"ポンプ直送（静水圧 < 0.45MPa）: 静水圧 "
                    f"{static_pressure_mpa:.3f} MPa × 100% = {waterhammer_mpa:.3f} MPa"
                )
            else:
                waterhammer_mpa = max(static_pressure_mpa * 0.60, 0.45)
                rule = (
                    f"ポンプ直送（静水圧 ≥ 0.45MPa）: max("
                    f"{static_pressure_mpa:.3f} × 60%, 0.45) = "
                    f"{waterhammer_mpa:.3f} MPa"
                )

        # ── ポンプ系 圧力タンク方式 ─────────────────────────────────────────
        case "pump_pressure_tank":
            if static_pressure_mpa < 0.35:
                waterhammer_mpa = static_pressure_mpa * 1.0
                rule = (
                    f"圧力タンク（静水圧 < 0.35MPa）: 静水圧 "
                    f"{static_pressure_mpa:.3f} MPa × 100% = {waterhammer_mpa:.3f} MPa"
                )
            else:
                waterhammer_mpa = max(static_pressure_mpa * 0.40, 0.35)
                rule = (
                    f"圧力タンク（静水圧 ≥ 0.35MPa）: max("
                    f"{static_pressure_mpa:.3f} × 40%, 0.35) = "
                    f"{waterhammer_mpa:.3f} MPa"
                )

        case _:
            raise ValueError(f"Unsupported pipeline system type: {system_type}")

    return EmpiricalWaterhammerResult(
        waterhammer_mpa=waterhammer_mpa,
        rule=rule,
        warnings=warnings,
    )


# ─── 単位変換 ─────────────────────────────────────────────────────────────────


def head_to_mpa(head_m: float) -> float:
    """水頭 [m] → 圧力 [MPa] 変換."""
    return (head_m * WATER_UNIT_WEIGHT) / 1000


def mpa_to_head(pressure_mpa: float) -> float:
    """圧力 [MPa] → 水頭 [m] 変換."""
    return (pressure_mpa * 1000) / WATER_UNIT_WEIGHT
