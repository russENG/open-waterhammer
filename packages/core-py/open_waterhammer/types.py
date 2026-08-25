"""ドメインモデル型定義.

出典: 土地改良設計基準パイプライン技術書 第8章
"""

from dataclasses import dataclass, field
from typing import Literal

# ─── 管種 ────────────────────────────────────────────────────────────────────

PipeType = Literal[
    "steel",
    "ductile_iron",
    "rcp",
    "cpcp",
    "upvc",
    "pe2",
    "pe3_pe100",
    "wdpe",
    "grp_fw1",
    "grp_fw2",
    "grp_fw3",
    "grp_fw4",
    "grp_fw5",
    "gfpe",
]

# ─── 管路区間 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Pipe:
    """管路区間の物性・寸法."""

    id: str
    start_node_id: str
    end_node_id: str
    pipe_type: PipeType
    inner_diameter: float  # 管内径 D [m]
    wall_thickness: float  # 管厚 t [m]
    length: float  # 管路延長 L [m]
    roughness_coeff: float  # 粗度係数 (Hazen-Williams C)
    name: str | None = None
    youngs_modulus: float | None = None  # ヤング係数 Eₛ [kN/m²]
    c1_coeff: float | None = None  # 埋設状況係数 C₁ (デフォルト 1.0)


# ─── 計算結果 ─────────────────────────────────────────────────────────────────

ClosureType = Literal["rapid", "slow", "numerical_required"]


@dataclass(frozen=True)
class WaveSpeedResult:
    wave_speed: float  # 波速 a [m/s]
    vibration_period: float  # 圧力振動周期 T₀ [s]
    alpha: float  # α = t₀/T₀


@dataclass(frozen=True)
class ClosureDetermination:
    closure_type: ClosureType
    alpha: float


# ─── 経験則 ──────────────────────────────────────────────────────────────────

PipelineSystemType = Literal[
    "gravity_open",  # 自然圧送 オープンタイプ
    "gravity_closed",  # 自然圧送 クローズドタイプ
    "gravity_semi_closed",  # 自然圧送 セミ・クローズドタイプ
    "pump_distribution_tank",  # ポンプ系 配水槽方式
    "pump_direct",  # ポンプ系 直送方式
    "pump_pressure_tank",  # ポンプ系 圧力タンク方式
]


@dataclass(frozen=True)
class EmpiricalWaterhammerResult:
    waterhammer_mpa: float
    rule: str
    warnings: list[str]


# ─── 耐圧判定 ─────────────────────────────────────────────────────────────────

JudgementStatus = Literal["ok", "ng", "warning"]


@dataclass(frozen=True)
class JudgementResult:
    status: JudgementStatus
    design_pressure_mpa: float
    allowable_pressure_mpa: float
    margin: float
    message: str


# ─── 計算ケース ───────────────────────────────────────────────────────────────

OperationType = Literal["valve_close", "valve_open", "pump_stop", "pump_start", "combined"]


@dataclass(frozen=True)
class CalculationCase:
    """計算ケース（操作シナリオ）."""

    id: str
    name: str
    operation_type: OperationType
    target_facility_id: str
    initial_velocity: float  # V₀ [m/s]
    initial_head: float  # H₀ [m]
    description: str | None = None


# ─── 測点（成果品様式 水理計算書）─────────────────────────────────────────────


@dataclass(frozen=True)
class MeasurementPoint:
    """測点データ.

    出典: 農水省 成果品様式「計画最大流量時の水理計算書」.
    管路を水平距離ベースで区切った各点の諸元.
    """

    id: str  # 測点ID（例: "IP.161", "No67+80"）
    horizontal_distance: float  # 単距離 Lh [m]
    ground_level: float  # 地盤高 GL [m]
    pipe_center_height: float  # 管中心高 FH [m]
    pipe_length: float  # 管長 SL [m]（実延長/斜距離）
    flow_rate: float  # 流量 Q [m³/s]
    diameter: float  # 管径 D [m]（内径）
    roughness_c: float  # 流速係数 CI（Hazen-Williams C）
    bend_loss_coeff: float  # 湾曲損失係数 fb [-]
    valve_loss_coeff: float  # バルブ損失係数 fv [-]
    branch_loss_coeff: float  # 直角分流損失係数 fβ [-]
    name: str | None = None
    other_loss: float | None = None  # その他局部損失水頭 [m]


@dataclass(frozen=True)
class MeasurementPointResult:
    """測点ごとの水理計算結果."""

    point_id: str
    hydraulic_gradient: float  # 動水勾配 I
    velocity: float  # 流速 V [m/s]
    velocity_head: float  # 速度水頭 hv [m]
    friction_loss: float  # 摩擦損失水頭 hf [m]
    total_loss_coeff: float  # Σf [-]
    minor_loss: float  # Σhc [m]
    total_loss: float  # 全損失水頭 h [m]
    energy_level: float  # エネルギー標高 EL [m]
    hydraulic_grade_line: float  # 動水位 WLm [m]
    pressure_head: float  # 動水頭 hm [m]
    static_pressure: float  # 静水圧 Ps [MPa]
    # 水撃圧 Pi [MPa]。静水圧に比例させる指定（waterhammer_ratio・既定の40%）は正圧を前提と
    # した経験則なので、static_pressure <= 0 の測点では算定せず None を返す。
    # waterhammer_pressure_mpa で絶対値を指定した場合は静水圧の符号によらずその値を使う。
    waterhammer_pressure: float | None
    design_pressure: float | None  # 設計内圧 Pp [MPa] = Ps + Pi。Pi 未算定なら None


@dataclass(frozen=True)
class LongitudinalHydraulicInput:
    """縦断水理計算の入力."""

    points: list[MeasurementPoint]
    static_water_level: float  # 静水位 [m]
    waterhammer_pressure_mpa: float | None = None
    waterhammer_ratio: float | None = None
    case_name: str | None = None


@dataclass(frozen=True)
class LongitudinalHydraulicResult:
    """縦断水理計算の結果."""

    case_name: str
    static_water_level: float
    point_results: list[MeasurementPointResult]
    max_velocity: float
    max_design_pressure: float
    warnings: list[str] = field(default_factory=list)


# ─── 簡易式計算結果 ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SimpleFormulaResult:
    """簡易式（ジューコフスキー / アリエビ）の計算結果."""

    case_id: str
    pipe_id: str
    wave_speed: WaveSpeedResult
    closure_type: ClosureType
    delta_h_joukowsky: float | None = None
    hmax_allievi_close: float | None = None
    hmax_allievi_open: float | None = None
    k1: float | None = None
    allievi_applicable: bool | None = None
    warnings: list[str] = field(default_factory=list)
