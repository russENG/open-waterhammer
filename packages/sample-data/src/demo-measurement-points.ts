/**
 * デモ測点データ: 農業用パイプライン縦断水理計算
 *
 * 出典: 農水省 成果品様式「パイプライン」Ⅱ-170〜171
 *       計画最大流量時の水理計算書（φ600 ダクタイル鋳鉄管、C=130、Q=451.50 L/s）
 *       静水位: ○○吐水槽 H.W.L = 580.600 m
 *
 * 全31測点（IP.161〜IP.189 + No67+80, IP.69+0）を記載例どおりに収録。
 */

import type { CalculationCase, MeasurementPoint, Node, Pipe } from "@open-waterhammer/core";

/** 成果品様式記載例 水理計算書の全測点データ（31点） */
export const DEMO_MEASUREMENT_POINTS: MeasurementPoint[] = [
  // ID,          Lh,      GL,      FH,       SL,      Q(m³/s), D(m),  C,   fb,    fv, fβ
  { id: "IP.161", pipeId: "pipe-01", horizontalDistance: 25.776, groundLevel: 477.20, pipeCenterHeight: 475.533, pipeLength: 25.874, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.162", pipeId: "pipe-01", horizontalDistance:  9.000, groundLevel: 478.01, pipeCenterHeight: 476.402, pipeLength:  9.033, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.163", pipeId: "pipe-01", horizontalDistance:  7.583, groundLevel: 478.71, pipeCenterHeight: 477.050, pipeLength:  7.611, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.164", pipeId: "pipe-01", horizontalDistance: 16.810, groundLevel: 480.32, pipeCenterHeight: 478.625, pipeLength: 16.884, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.165", pipeId: "pipe-01", horizontalDistance:  9.957, groundLevel: 481.43, pipeCenterHeight: 479.557, pipeLength: 10.001, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.166", pipeId: "pipe-01", horizontalDistance: 12.607, groundLevel: 482.38, pipeCenterHeight: 480.738, pipeLength: 12.662, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.167", pipeId: "pipe-01", horizontalDistance:  9.200, groundLevel: 483.16, pipeCenterHeight: 481.600, pipeLength:  9.240, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.168", pipeId: "pipe-01", horizontalDistance:  8.812, groundLevel: 484.11, pipeCenterHeight: 482.313, pipeLength:  8.841, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.169", pipeId: "pipe-01", horizontalDistance: 12.355, groundLevel: 485.14, pipeCenterHeight: 483.313, pipeLength: 12.395, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.170", pipeId: "pipe-01", horizontalDistance: 17.148, groundLevel: 486.24, pipeCenterHeight: 484.700, pipeLength: 17.204, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.171", pipeId: "pipe-01", horizontalDistance: 10.400, groundLevel: 486.77, pipeCenterHeight: 485.225, pipeLength: 10.413, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.059, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.172", pipeId: "pipe-01", horizontalDistance: 10.811, groundLevel: 487.34, pipeCenterHeight: 485.771, pipeLength: 10.825, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.173", pipeId: "pipe-01", horizontalDistance:  9.566, groundLevel: 487.95, pipeCenterHeight: 485.254, pipeLength:  9.578, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.174", pipeId: "pipe-01", horizontalDistance:  7.866, groundLevel: 488.46, pipeCenterHeight: 486.651, pipeLength:  7.876, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.175", pipeId: "pipe-01", horizontalDistance: 11.866, groundLevel: 489.01, pipeCenterHeight: 487.250, pipeLength: 11.881, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.176", pipeId: "pipe-01", horizontalDistance: 13.065, groundLevel: 489.69, pipeCenterHeight: 488.092, pipeLength: 13.092, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.177", pipeId: "pipe-01", horizontalDistance: 13.032, groundLevel: 490.51, pipeCenterHeight: 488.933, pipeLength: 13.059, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.178", pipeId: "pipe-01", horizontalDistance: 11.128, groundLevel: 491.22, pipeCenterHeight: 489.650, pipeLength: 11.151, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.179", pipeId: "pipe-01", horizontalDistance: 31.258, groundLevel: 493.10, pipeCenterHeight: 491.368, pipeLength: 31.305, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.180", pipeId: "pipe-01", horizontalDistance: 12.402, groundLevel: 493.72, pipeCenterHeight: 492.050, pipeLength: 12.421, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.181", pipeId: "pipe-01", horizontalDistance: 25.282, groundLevel: 495.22, pipeCenterHeight: 493.703, pipeLength: 25.336, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.182", pipeId: "pipe-01", horizontalDistance: 16.007, groundLevel: 496.41, pipeCenterHeight: 494.750, pipeLength: 16.041, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.183", pipeId: "pipe-01", horizontalDistance: 14.343, groundLevel: 496.80, pipeCenterHeight: 495.275, pipeLength: 14.353, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "No67+80", pipeId: "pipe-01", horizontalDistance: 10.268, groundLevel: 497.20, pipeCenterHeight: 495.650, pipeLength: 10.275, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.184", pipeId: "pipe-01", horizontalDistance: 19.650, groundLevel: 498.95, pipeCenterHeight: 497.401, pipeLength: 19.728, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.185", pipeId: "pipe-01", horizontalDistance:  8.963, groundLevel: 499.76, pipeCenterHeight: 498.200, pipeLength:  8.999, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.186", pipeId: "pipe-01", horizontalDistance: 35.058, groundLevel: 502.02, pipeCenterHeight: 500.395, pipeLength: 35.127, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.187", pipeId: "pipe-01", horizontalDistance: 14.449, groundLevel: 502.88, pipeCenterHeight: 501.300, pipeLength: 14.477, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.188", pipeId: "pipe-01", horizontalDistance: 11.429, groundLevel: 503.38, pipeCenterHeight: 501.445, pipeLength: 11.430, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.69+0", pipeId: "pipe-01", horizontalDistance: 30.451, groundLevel: 503.73, pipeCenterHeight: 501.830, pipeLength: 30.453, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.189", pipeId: "pipe-01", horizontalDistance: 16.540, groundLevel: 503.06, pipeCenterHeight: 501.030, pipeLength: 15.659, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
];

/** 成果品様式記載例の静水位 [m] */
export const DEMO_STATIC_WATER_LEVEL = 580.600;

/**
 * 測点列が表す管路（成果品様式記載例と同じ φ600 ダクタイル鋳鉄管）。
 *
 * 管路延長 L は測点の管長 SL の総和（Σ SL = 463.224 m）。
 * 管厚 t = 11 mm は φ600 ダクタイル鋳鉄管の代表値。
 * 許容圧力は呼び圧力 1.6 MPa（設計水圧の判定に使う）。
 *
 * 入力テンプレート（`generateTemplate`）は、この管路・節点・ケースと
 * `DEMO_MEASUREMENT_POINTS` を1本の管路として一体で出力する。
 * 測点表とシート間で管径・延長が食い違わないよう、必ずこの組で使うこと。
 */
export const DEMO_LONGITUDINAL_PIPE: Pipe = {
  id: "pipe-01",
  name: "幹線用水路",
  startNodeId: "N1",
  endNodeId: "N2",
  pipeType: "ductile_iron",
  innerDiameter: 0.600,          // φ600（測点表の管径 D と一致）
  wallThickness: 0.011,          // 11 mm
  length: 463.224,               // Σ SL
  roughnessCoeff: 130,           // 測点表の流速係数 CI と一致
  allowablePressureMpa: 1.6,     // 呼び圧力 1.6 MPa
};

/**
 * 節点。上流の吐水槽 HWL を静水位 580.600 m に、末端バルブを最下流測点 IP.189 の
 * 管中心高 501.030 m に置く。これにより末端の静水頭 H₀ = 79.570 m が
 * 測点表の縦断と整合する。
 */
export const DEMO_LONGITUDINAL_NODES: Node[] = [
  { id: "N1", name: "上流吐水槽", elevation: DEMO_STATIC_WATER_LEVEL, nodeType: "reservoir", hydraulicGrade: DEMO_STATIC_WATER_LEVEL },
  { id: "N2", name: "末端バルブ", elevation: 501.030, nodeType: "valve_node" },
];

/** 末端バルブ位置の初期流速 V₀ [m/s] = Q / A（測点表の Q・D から算定） */
export const DEMO_LONGITUDINAL_INITIAL_VELOCITY = 1.597;

/** 末端バルブ位置の初期圧力水頭 H₀ [m] = 静水位 − 管中心高 */
export const DEMO_LONGITUDINAL_INITIAL_HEAD = 79.570;

/**
 * 水撃圧の比較ケース。同じ管路・同じ初期条件で、等価閉そく時間だけを変える。
 * 急閉そく（tν = 0.5 s）と緩閉そく（tν = 10 s）の対比が、テンプレートの主題。
 */
export const DEMO_LONGITUDINAL_CASES: CalculationCase[] = [
  {
    id: "case-01",
    name: "バルブ急閉そく",
    description: "末端バルブを急閉した場合の水撃圧（ジューコフスキー式適用）",
    operationType: "valve_close",
    targetFacilityId: "valve-01",
    initialVelocity: DEMO_LONGITUDINAL_INITIAL_VELOCITY,
    initialHead: DEMO_LONGITUDINAL_INITIAL_HEAD,
    closeTime: 0.5,
  },
  {
    id: "case-02",
    name: "バルブ緩閉そく",
    description: "末端バルブを緩やかに閉じた場合（アリエビ式適用）。急閉そくとの比較用。",
    operationType: "valve_close",
    targetFacilityId: "valve-01",
    initialVelocity: DEMO_LONGITUDINAL_INITIAL_VELOCITY,
    initialHead: DEMO_LONGITUDINAL_INITIAL_HEAD,
    closeTime: 10,
  },
];

export const DEMO_MEASUREMENT_POINTS_DESCRIPTION = `
デモ測点データ: 縦断水理計算（成果品様式記載例）
────────────────────────────────────────────────
出典: 農水省 成果品様式「パイプライン」Ⅱ-170〜171
      計画最大流量時の水理計算書
管種: ダクタイル鋳鉄管 φ600mm
流量: Q = 451.50 L/s
流速係数: C = 130
静水位: 580.600 m（吐水槽 HWL）
測点数: 31点（IP.161〜IP.189 全数収録）

参照: 土地改良設計基準パイプライン（令和3年6月改訂）第5章
`.trim();

/**
 * 入力テンプレートの既定の案件名。
 *
 * かつては `（案件名を入力）` というプレースホルダーを入れており、
 * 取込側がその文字列を明示的に拒否していたため、配布したテンプレートを
 * そのまま読み込めなかった。サンプル名にして読み込めるようにし、
 * 書き換え忘れは取込時の警告で知らせる。
 */
export const TEMPLATE_SAMPLE_PROJECT_NAME = "サンプル：幹線用水路 水撃圧検討";
