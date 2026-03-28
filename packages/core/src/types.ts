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
  | "wdpe1"
  | "wdpe2"
  | "wdpe3"
  | "wdpe4"
  | "wdpe5"
  | "grp_fw"
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
