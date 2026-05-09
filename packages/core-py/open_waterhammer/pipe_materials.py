"""管材別物性値.

出典: 土地改良設計基準パイプライン技術書 表-8.2.1
"""

from dataclasses import dataclass

from .types import PipeType


@dataclass(frozen=True)
class PipeMaterial:
    """管材の物性."""

    type: PipeType
    name: str
    youngs_modulus_short: float  # 短期ヤング係数 Eₛ [kN/m²]
    is_resin: bool  # 樹脂系管材は True (長期 = Eₛ × 0.8)


PIPE_MATERIALS: dict[PipeType, PipeMaterial] = {
    "steel": PipeMaterial(
        type="steel",
        name="鋼管",
        youngs_modulus_short=200e6,
        is_resin=False,
    ),
    "ductile_iron": PipeMaterial(
        type="ductile_iron",
        name="ダクタイル鋳鉄管",
        youngs_modulus_short=160e6,
        is_resin=False,
    ),
    "rcp": PipeMaterial(
        type="rcp",
        name="遠心力鉄筋コンクリート管",
        youngs_modulus_short=20e6,
        is_resin=False,
    ),
    "cpcp": PipeMaterial(
        type="cpcp",
        name="コア式プレストレストコンクリート管",
        youngs_modulus_short=39e6,
        is_resin=False,
    ),
    "upvc": PipeMaterial(
        type="upvc",
        name="硬質ポリ塩化ビニル管",
        youngs_modulus_short=3e6,
        is_resin=True,
    ),
    "pe2": PipeMaterial(
        type="pe2",
        name="一般用ポリエチレン管(2種)",
        youngs_modulus_short=1e6,
        is_resin=True,
    ),
    "pe3_pe100": PipeMaterial(
        type="pe3_pe100",
        name="一般用ポリエチレン管(3種 PE100)",
        youngs_modulus_short=1.3e6,
        is_resin=True,
    ),
    "wdpe": PipeMaterial(
        type="wdpe",
        name="水道配水用ポリエチレン管",
        youngs_modulus_short=1.3e6,
        is_resin=True,
    ),
    # 強化プラスチック複合管 FW成形 (技術書 表-8.2.1 注2)
    # 種番号が大きいほど Eₛ が大きい
    "grp_fw1": PipeMaterial(
        type="grp_fw1",
        name="強化プラスチック複合管 FW(1種)",
        youngs_modulus_short=14.7e6,
        is_resin=True,
    ),
    "grp_fw2": PipeMaterial(
        type="grp_fw2",
        name="強化プラスチック複合管 FW(2種)",
        youngs_modulus_short=15.2e6,
        is_resin=True,
    ),
    "grp_fw3": PipeMaterial(
        type="grp_fw3",
        name="強化プラスチック複合管 FW(3種)",
        youngs_modulus_short=16.7e6,
        is_resin=True,
    ),
    "grp_fw4": PipeMaterial(
        type="grp_fw4",
        name="強化プラスチック複合管 FW(4種)",
        youngs_modulus_short=19.6e6,
        is_resin=True,
    ),
    "grp_fw5": PipeMaterial(
        type="grp_fw5",
        name="強化プラスチック複合管 FW(5種)",
        youngs_modulus_short=21.6e6,
        is_resin=True,
    ),
    "gfpe": PipeMaterial(
        type="gfpe",
        name="ガラス繊維強化ポリエチレン管",
        youngs_modulus_short=2.5e6,
        is_resin=True,
    ),
}


def get_long_term_youngs_modulus(pipe_type: PipeType) -> float:
    """長期ヤング係数 [kN/m²].

    樹脂系: × 0.8、その他: 短期値と同じ.
    """
    mat = PIPE_MATERIALS[pipe_type]
    return mat.youngs_modulus_short * 0.8 if mat.is_resin else mat.youngs_modulus_short
