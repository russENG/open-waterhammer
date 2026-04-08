/**
 * ドメインモデル型定義
 * 出典: 土地改良設計基準パイプライン技術書 第8章
 */

// ─── 管種 ────────────────────────────────────────────────────────────────────

export type PipeType =
  | "steel"
  | "ductile_iron"
  | "rcp"
  | "cpcp"
  | "upvc"
  | "pe2"
  | "pe3_pe100"
  | "wdpe"
  | "grp_fw1"
  | "grp_fw2"
  | "grp_fw3"
  | "grp_fw4"
  | "grp_fw5"
  | "gfpe";

// ─── 管路区間 ─────────────────────────────────────────────────────────────────

export interface Pipe {
  id: string;
  name?: string;
  startNodeId: string;
  endNodeId: string;
  pipeType: PipeType;
  /** 管内径 D [m] */
  innerDiameter: number;
  /** 管厚 t [m] */
  wallThickness: number;
  /** 管路延長 L [m] */
  length: number;
  /** 粗度係数 (ハーゼン・ウィリアムス C または マニング n) */
  roughnessCoeff: number;
  /** ヤング係数 Eₛ [kN/m²] — 省略時は管種から自動参照 */
  youngsModulus?: number;
  /** 埋設状況係数 C₁ — デフォルト 1.0 */
  c1Coeff?: number;
}

// ─── 節点 ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | "reservoir"
  | "junction"
  | "tank"
  | "pump_node"
  | "valve_node";

export interface Node {
  id: string;
  name?: string;
  elevation: number;
  nodeType: NodeType;
  /** 動水位（定常計算結果で更新） [m] */
  hydraulicGrade?: number;
}

// ─── バルブ ───────────────────────────────────────────────────────────────────

export type ValveType =
  | "gate"
  | "butterfly"
  | "air_release"
  | "check"
  | "pressure_relief";

export interface Valve {
  id: string;
  nodeId: string;
  valveType: ValveType;
  /** 等価閉そく時間 tν [s] */
  closeTime: number;
  openTime?: number;
}

// ─── パイプラインネットワーク ─────────────────────────────────────────────────

export interface PipelineNetwork {
  nodes: Node[];
  pipes: Pipe[];
  valves: Valve[];
}

// ─── 計算ケース ───────────────────────────────────────────────────────────────

export type OperationType =
  | "valve_close"
  | "valve_open"
  | "pump_stop"
  | "pump_start"
  | "combined";

export interface CalculationCase {
  id: string;
  name: string;
  description?: string;
  operationType: OperationType;
  targetFacilityId: string;
  /** 初期流速 V₀ [m/s] */
  initialVelocity: number;
  /** 初期圧力水頭 H₀ [m] */
  initialHead: number;
}

// ─── 測点（成果品様式 水理計算書） ──────────────────────────────────────────────

/**
 * 測点データ
 * 出典: 農水省 成果品様式「計画最大流量時の水理計算書」
 *
 * 管路を水平距離ベースで区切った各点の諸元。
 * 縦断水理計算ではこの測点列を上流→下流に走査して損失を累積する。
 */
export interface MeasurementPoint {
  /** 測点ID (例: "IP.161", "No67+80") */
  id: string;
  /** 測点名（任意） */
  name?: string;
  /** 単距離 Lh [m] — 前測点からの水平距離 */
  horizontalDistance: number;
  /** 地盤高 GL [m] */
  groundLevel: number;
  /** 管中心高 FH [m] */
  pipeCenterHeight: number;
  /** 管長 SL [m] — 実延長（斜距離） */
  pipeLength: number;
  /** 流量 Q [m³/s] */
  flowRate: number;
  /** 管径 D [m] (内径) */
  diameter: number;
  /** 流速係数 CI (Hazen-Williams C) */
  roughnessC: number;
  /** 湾曲損失係数 fb [-] */
  bendLossCoeff: number;
  /** バルブ損失係数 fv [-] */
  valveLossCoeff: number;
  /** 直角分流損失係数 fβ [-] */
  branchLossCoeff: number;
  /** その他局部損失水頭 [m]（直接入力がある場合） */
  otherLoss?: number;
}

/**
 * 測点ごとの水理計算結果
 * 公式帳票の右半分（計算値列）に対応
 */
export interface MeasurementPointResult {
  /** 測点ID */
  pointId: string;
  /** 動水勾配 I [‰] */
  hydraulicGradient: number;
  /** 流速 V [m/s] */
  velocity: number;
  /** 速度水頭 hv [m] = V²/2g */
  velocityHead: number;
  /** 摩擦損失水頭 hf [m] */
  frictionLoss: number;
  /** 損失係数計 Σf [-] = fb + fv + fβ */
  totalLossCoeff: number;
  /** その他損失水頭計 Σhc [m] = Σf × hv + otherLoss */
  minorLoss: number;
  /** 全損失水頭 h [m] = hf + Σhc */
  totalLoss: number;
  /** エネルギー標高 EL [m] */
  energyLevel: number;
  /** 動水位 WLm [m] */
  hydraulicGradeLine: number;
  /** 動水頭 hm [m] = WLm - 管中心高 */
  pressureHead: number;
  /** 静水圧 Ps [MPa] */
  staticPressure: number;
  /** 水撃圧 Pi [MPa] */
  waterhammerPressure: number;
  /** 設計内圧 Pp [MPa] = Ps + Pi */
  designPressure: number;
}

/**
 * 縦断水理計算の入力条件
 */
export interface LongitudinalHydraulicInput {
  /** 測点列（上流→下流の順） */
  points: MeasurementPoint[];
  /** 静水位 [m]（上流水槽の HWL 等） */
  staticWaterLevel: number;
  /** 水撃圧の値 [MPa]（別途算定済みの場合に直接入力） */
  waterhammerPressureMpa?: number;
  /** 水撃圧を静水圧の割合で設定 (例: 0.4 = 静水圧×40%) */
  waterhammerRatio?: number;
  /** 計算ケース名（"計画最大流量" | "最多頻度流量" 等） */
  caseName?: string;
}

/**
 * 縦断水理計算の結果
 */
export interface LongitudinalHydraulicResult {
  /** ケース名 */
  caseName: string;
  /** 静水位 [m] */
  staticWaterLevel: number;
  /** 各測点の計算結果 */
  pointResults: MeasurementPointResult[];
  /** 最大流速 [m/s] */
  maxVelocity: number;
  /** 最大設計内圧 [MPa] */
  maxDesignPressure: number;
  warnings: string[];
}

// ─── 計算結果 ─────────────────────────────────────────────────────────────────

export type ClosureType = "rapid" | "slow" | "numerical_required";

export interface WaveSpeedResult {
  /** 波速 a [m/s] */
  waveSpeed: number;
  /** 圧力振動周期 T₀ [s] */
  vibrationPeriod: number;
  /** α値 = t₀/T₀ */
  alpha: number;
}

export interface SimpleFormulaResult {
  caseId: string;
  pipeId: string;
  waveSpeed: WaveSpeedResult;
  closureType: ClosureType;
  /** 水撃圧水頭 ΔH [m] (ジューコフスキー) */
  deltaH_joukowsky?: number;
  /** 最大水撃圧水頭 Hmax [m] (アリエビ・閉) */
  hmax_allievi_close?: number;
  /** 最大圧力低下 Hmax [m] (アリエビ・開) */
  hmax_allievi_open?: number;
  /** アリエビ式 K₁値 */
  k1?: number;
  /** アリエビ式適用条件 (tν > L/300) を満たすか */
  allieviApplicable?: boolean;
  warnings: string[];
}

export interface DesignPressureResult {
  pipeId: string;
  /** 静水圧 [MPa] */
  staticPressureMpa: number;
  /** 水撃圧 [MPa] */
  waterhammerPressureMpa: number;
  /** 設計水圧 = 静水圧 + 水撃圧 [MPa] */
  designPressureMpa: number;
  /** 負圧発生フラグ */
  negativePressure: boolean;
}

// ─── 経験則による水撃圧 ──────────────────────────────────────────────────────

/**
 * パイプライン系統の方式区分
 * 出典: 土地改良設計基準パイプライン技術書 8.3.5節
 */
export type PipelineSystemType =
  | "gravity_open"           // 自然圧送 オープンタイプ
  | "gravity_closed"         // 自然圧送 クローズドタイプ（§8.3.5 a.② で セミクローズドと同式）
  | "gravity_semi_closed"    // 自然圧送 セミ・クローズドタイプ
  | "pump_distribution_tank" // ポンプ系 配水槽方式
  | "pump_direct"            // ポンプ系 直送方式（コントロールなし/あり）
  | "pump_pressure_tank";    // ポンプ系 圧力タンク方式

export interface EmpiricalWaterhammerResult {
  /** 水撃圧 [MPa] */
  waterhammerMpa: number;
  /** 適用した判定式 */
  rule: string;
  warnings: string[];
}

// ─── 耐圧判定 ─────────────────────────────────────────────────────────────────

/** 耐圧判定結果 */
export type JudgementStatus = "ok" | "ng" | "warning";

export interface JudgementResult {
  /** 判定区分 */
  status: JudgementStatus;
  /** 設計水圧 [MPa] */
  designPressureMpa: number;
  /** 許容圧力 [MPa] */
  allowablePressureMpa: number;
  /** 余裕度 = (許容 - 設計) / 許容 [0〜1] */
  margin: number;
  /** 判定メッセージ */
  message: string;
}
