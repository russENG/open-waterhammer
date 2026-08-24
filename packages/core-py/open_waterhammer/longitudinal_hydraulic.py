"""縦断水理計算エンジン.

出典: 農水省 成果品様式「計画最大流量時の水理計算書」
        土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）§5

測点ベースで上流→下流に損失を累積し、各測点のエネルギー標高・動水位・
静水圧・設計内圧を算出.
"""

import math

from .formulas import GRAVITY, head_to_mpa
from .types import (
    LongitudinalHydraulicInput,
    LongitudinalHydraulicResult,
    MeasurementPoint,
    MeasurementPointResult,
)


# ─── 局部損失計算 ────────────────────────────────────────────────────────────


def calc_total_loss_coeff(point: MeasurementPoint) -> float:
    """局部損失係数の合計 Σf [-].

    Σf = fb + fv + fβ
    """
    return point.bend_loss_coeff + point.valve_loss_coeff + point.branch_loss_coeff


def calc_minor_loss(
    total_loss_coeff: float,
    velocity_head: float,
    other_loss: float,
) -> float:
    """局部損失水頭 Σhc [m].

    Σhc = Σf × V²/2g + その他損失
    """
    return total_loss_coeff * velocity_head + other_loss


# ─── 1測点の摩擦損失 ────────────────────────────────────────────────────────


def calc_segment_friction(
    diameter: float,
    roughness_c: float,
    velocity: float,
    pipe_length: float,
) -> tuple[float, float]:
    """Hazen-Williams 式で1区間の摩擦損失水頭を算定（技術書 式7.2.2）.

    V = 0.849 × C × R^0.63 × I^0.54
    → I = (V / (0.849 × C × R^0.63))^(1/0.54)
    → hf = I × SL

    Args:
        diameter: D [m].
        roughness_c: Hazen-Williams C.
        velocity: V [m/s].
        pipe_length: SL [m]（実延長）.

    Returns:
        (hydraulic_gradient I, friction_loss hf [m]).
    """
    rh = diameter / 4
    i_grad = (velocity / (0.849 * roughness_c * rh**0.63)) ** (1 / 0.54)
    hf = i_grad * pipe_length
    return (i_grad, hf)


# ─── 縦断水理計算 ────────────────────────────────────────────────────────────


def calc_longitudinal_hydraulic(
    input_data: LongitudinalHydraulicInput,
) -> LongitudinalHydraulicResult:
    """縦断水理計算（メイン関数）.

    上流から下流に向かって各測点の損失を累積し、
    エネルギー標高 EL・動水位 WLm・動水頭 hm・静水圧 Ps・水撃圧 Pi・
    設計内圧 Pp を算出する.

    初期エネルギー標高 = 静水位（水槽 HWL）.
    各測点: EL = 前測点EL - 全損失水頭 h
            WLm = EL - 速度水頭 hv
            hm = WLm - 管中心高 FH
            Ps = hm × w₀ / 1000 [MPa]
            Pi = 入力指定値 or Ps × 割合
            Pp = Ps + Pi
    """
    points = input_data.points
    static_water_level = input_data.static_water_level
    waterhammer_pressure_mpa = input_data.waterhammer_pressure_mpa
    waterhammer_ratio = input_data.waterhammer_ratio
    case_name = input_data.case_name if input_data.case_name is not None else "計画最大流量"

    warnings: list[str] = []
    point_results: list[MeasurementPointResult] = []

    if len(points) == 0:
        return LongitudinalHydraulicResult(
            case_name=case_name,
            static_water_level=static_water_level,
            point_results=[],
            max_velocity=0,
            max_design_pressure=0,
            warnings=["測点データがありません"],
        )

    max_velocity = 0.0
    max_design_pressure = 0.0
    # 初期エネルギー標高 = 静水位
    prev_el = static_water_level

    for i, pt in enumerate(points):
        # 断面積・流速
        area = math.pi * pt.diameter * pt.diameter / 4
        v = pt.flow_rate / area
        hv = v * v / (2 * GRAVITY)

        # 摩擦損失
        i_grad, hf = calc_segment_friction(pt.diameter, pt.roughness_c, v, pt.pipe_length)

        # 局部損失
        total_loss_coeff = calc_total_loss_coeff(pt)
        other = pt.other_loss if pt.other_loss is not None else 0.0
        minor_loss = calc_minor_loss(total_loss_coeff, hv, other)

        # 全損失水頭
        total_loss = hf + minor_loss

        # エネルギー標高
        el = prev_el - total_loss

        # 動水位 = エネルギー標高 - 速度水頭
        w_lm = el - hv

        # 動水頭 = 動水位 - 管中心高
        hm = w_lm - pt.pipe_center_height

        # 静水圧 [MPa]
        p_s = head_to_mpa(hm)

        # 水撃圧 [MPa]
        if waterhammer_pressure_mpa is not None:
            p_i = waterhammer_pressure_mpa
        elif waterhammer_ratio is not None:
            p_i = p_s * waterhammer_ratio
        else:
            p_i = p_s * 0.4  # デフォルト: 静水圧×40%
            if i == 0:
                warnings.append(
                    "水撃圧が未指定のため、静水圧×40%で仮算定しています。"
                    "別途水撃圧計算（Step 2〜4）の結果を適用してください。"
                )

        # 設計内圧 [MPa]
        p_p = p_s + p_i

        # 警告
        if v < 0.5:
            warnings.append(
                f"{pt.id}: 流速 {v:.2f} m/s は推奨下限 0.5 m/s を下回っています"
            )
        if v > 2.5:
            warnings.append(
                f"{pt.id}: 流速 {v:.2f} m/s は推奨上限 2.5 m/s を超えています"
            )
        if hm < 0:
            warnings.append(
                f"{pt.id}: 動水頭 {hm:.2f} m が負圧です。管路が動水位を超えています"
            )

        max_velocity = max(max_velocity, v)
        max_design_pressure = max(max_design_pressure, p_p)

        point_results.append(
            MeasurementPointResult(
                point_id=pt.id,
                hydraulic_gradient=i_grad,
                velocity=v,
                velocity_head=hv,
                friction_loss=hf,
                total_loss_coeff=total_loss_coeff,
                minor_loss=minor_loss,
                total_loss=total_loss,
                energy_level=el,
                hydraulic_grade_line=w_lm,
                pressure_head=hm,
                static_pressure=p_s,
                waterhammer_pressure=p_i,
                design_pressure=p_p,
            )
        )

        prev_el = el

    return LongitudinalHydraulicResult(
        case_name=case_name,
        static_water_level=static_water_level,
        point_results=point_results,
        max_velocity=max_velocity,
        max_design_pressure=max_design_pressure,
        warnings=warnings,
    )
