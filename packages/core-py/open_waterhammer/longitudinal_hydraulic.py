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
    # 同じ内容の警告を測点ごとに積まないためのフラグ（31測点なら31行出てしまう）。
    provisional_waterhammer_reported = False
    negative_static_pressure_reported = False
    slow_points: list[str] = []
    fast_points: list[str] = []
    negative_head_points: list[tuple[str, float]] = []
    # 初期エネルギー標高 = 静水位
    prev_el = static_water_level

    for pt in points:
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
        #
        # 静水圧に比例させる指定（waterhammer_ratio・既定の40%）は正圧を前提にした経験則なので、
        # p_s <= 0 の測点に適用すると水撃圧・設計内圧まで負値になる。そこでは算定せず None を返し、
        # 帳票では「—」として空欄にする。waterhammer_pressure_mpa で絶対値を与えた場合は
        # 設計者が明示した値なので、静水圧の符号によらずそのまま使う。
        p_i: float | None
        if waterhammer_pressure_mpa is not None:
            p_i = waterhammer_pressure_mpa
        elif p_s <= 0:
            p_i = None
            if not negative_static_pressure_reported:
                negative_static_pressure_reported = True
                warnings.append(
                    "静水圧が0以下の測点があるため、その区間の水撃圧・設計内圧は算定していません。"
                    "水撃圧をMPaで直接指定するか、管路計画を見直してください。"
                )
        elif waterhammer_ratio is not None:
            p_i = p_s * waterhammer_ratio
        else:
            p_i = p_s * 0.4  # デフォルト: 静水圧×40%
            if not provisional_waterhammer_reported:
                provisional_waterhammer_reported = True
                warnings.append(
                    "水撃圧が未指定のため、静水圧×40%で仮算定しています。"
                    "別途水撃圧計算（Step 2〜4）の結果を適用してください。"
                )

        # 設計内圧 [MPa]
        p_p = None if p_i is None else p_s + p_i

        # 警告は測点ごとに積まず、ループ後にまとめて1行にする（31測点で31行出ると読めない）。
        if v < 0.5:
            slow_points.append(pt.id)
        if v > 2.5:
            fast_points.append(pt.id)
        if hm < 0:
            negative_head_points.append((pt.id, hm))

        max_velocity = max(max_velocity, v)
        if p_p is not None:
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

    if slow_points:
        warnings.append(
            f"流速が推奨下限 0.5 m/s を下回る測点が {len(slow_points)} 件あります"
            f"（{_summarize_ids(slow_points)}）。"
        )
    if fast_points:
        warnings.append(
            f"流速が推奨上限 2.5 m/s を超える測点が {len(fast_points)} 件あります"
            f"（{_summarize_ids(fast_points)}）。管径の拡大を検討してください。"
        )
    if negative_head_points:
        worst_id, worst_head = min(negative_head_points, key=lambda item: item[1])
        warnings.append(
            f"動水頭が負圧の測点が {len(negative_head_points)} 件あります"
            f"（最小 {worst_id} で {worst_head:.2f} m）。"
            "管路が動水位を超えています。水柱分離の検討が必要です。"
        )

    return LongitudinalHydraulicResult(
        case_name=case_name,
        static_water_level=static_water_level,
        point_results=point_results,
        max_velocity=max_velocity,
        max_design_pressure=max_design_pressure,
        warnings=warnings,
    )


def _summarize_ids(ids: list[str]) -> str:
    """警告文に測点IDを並べる。件数が多いときは先頭3件＋「ほかN件」に丸める。"""
    if len(ids) <= 3:
        return ", ".join(ids)
    return f"{', '.join(ids[:3])} ほか{len(ids) - 3}件"
