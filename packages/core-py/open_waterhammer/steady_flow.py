"""定常流水理計算（単管路・簡易計算）.

出典: 土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）第5章・第6章

Darcy-Weisbach 式および Hazen-Williams 式による摩擦損失水頭の算定.

注: 管路網の定常計算は EPA の EPANET エンジン（epanet-js, WASM）に委譲する.
本モジュールは単管路の簡易計算のみを担う.
"""

import math
from dataclasses import dataclass, field
from typing import Literal

from .formulas import GRAVITY


# ─── 型定義 ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SteadyFlowResult:
    """定常流計算の結果."""

    area: float  # 管内断面積 A [m²]
    velocity: float  # 平均流速 V [m/s]
    friction_loss: float  # 摩擦損失水頭 hf [m]
    hydraulic_gradient: float  # 動水勾配 I [-]
    elevation_diff: float  # 高低差（下流 - 上流）[m]
    total_head: float  # 必要全揚程（hf + 高低差）[m]
    velocity_head: float  # 速度水頭 V²/2g [m]
    method: Literal["darcy-weisbach", "hazen-williams"]
    warnings: list[str] = field(default_factory=list)


# ─── Darcy-Weisbach 式 ─────────────────────────────────────────────────────


def calc_darcy_weisbach(
    inner_diameter: float,
    length: float,
    flow_rate: float,
    upstream_elevation: float,
    downstream_elevation: float,
    friction_factor: float,
) -> SteadyFlowResult:
    """Darcy-Weisbach 式による摩擦損失水頭.

    hf = f × (L / D) × (V² / 2g)

    Args:
        inner_diameter: 管内径 D [m].
        length: 管路延長 L [m].
        flow_rate: 設計流量 Q [m³/s].
        upstream_elevation: 上流側標高 [m].
        downstream_elevation: 下流側標高 [m].
        friction_factor: 摩擦損失係数 f [-].
    """
    warnings: list[str] = []

    area = math.pi * inner_diameter * inner_diameter / 4
    velocity = flow_rate / area
    velocity_head = velocity * velocity / (2 * GRAVITY)
    hf = friction_factor * (length / inner_diameter) * velocity_head
    i_grad = hf / length
    elevation_diff = downstream_elevation - upstream_elevation
    total_head = hf + elevation_diff

    if velocity < 0.5:
        warnings.append(
            f"流速 {velocity:.2f} m/s は推奨下限 0.5 m/s を下回っています。"
        )
    if velocity > 2.5:
        warnings.append(
            f"流速 {velocity:.2f} m/s は推奨上限 2.5 m/s を超えています。"
            "管径の拡大を検討してください。"
        )

    return SteadyFlowResult(
        area=area,
        velocity=velocity,
        friction_loss=hf,
        hydraulic_gradient=i_grad,
        elevation_diff=elevation_diff,
        total_head=total_head,
        velocity_head=velocity_head,
        method="darcy-weisbach",
        warnings=warnings,
    )


# ─── Hazen-Williams 式 ─────────────────────────────────────────────────────


def calc_hazen_williams(
    inner_diameter: float,
    length: float,
    flow_rate: float,
    upstream_elevation: float,
    downstream_elevation: float,
    roughness_c: float,
) -> SteadyFlowResult:
    """Hazen-Williams 式による摩擦損失水頭.

    技術書 式(7.2.2):
        V = 0.849 × C × R^0.63 × I^0.54
        → I = (V / (0.849 × C × R^0.63))^(1/0.54)
        → hf = I × L

    Args:
        inner_diameter: 管内径 D [m].
        length: 管路延長 L [m].
        flow_rate: 設計流量 Q [m³/s].
        upstream_elevation: 上流側標高 [m].
        downstream_elevation: 下流側標高 [m].
        roughness_c: Hazen-Williams 粗度係数 C [-].
    """
    warnings: list[str] = []

    area = math.pi * inner_diameter * inner_diameter / 4
    velocity = flow_rate / area
    rh = inner_diameter / 4  # 円管の動水半径
    i_grad = (velocity / (0.849 * roughness_c * rh**0.63)) ** (1 / 0.54)
    hf = i_grad * length
    velocity_head = velocity * velocity / (2 * GRAVITY)
    elevation_diff = downstream_elevation - upstream_elevation
    total_head = hf + elevation_diff

    if velocity < 0.5:
        warnings.append(
            f"流速 {velocity:.2f} m/s は推奨下限 0.5 m/s を下回っています。"
        )
    if velocity > 2.5:
        warnings.append(
            f"流速 {velocity:.2f} m/s は推奨上限 2.5 m/s を超えています。"
            "管径の拡大を検討してください。"
        )

    return SteadyFlowResult(
        area=area,
        velocity=velocity,
        friction_loss=hf,
        hydraulic_gradient=i_grad,
        elevation_diff=elevation_diff,
        total_head=total_head,
        velocity_head=velocity_head,
        method="hazen-williams",
        warnings=warnings,
    )
