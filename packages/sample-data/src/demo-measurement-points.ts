/**
 * デモ測点データ: 農業用パイプライン縦断水理計算
 *
 * 出典: 農水省 成果品様式「パイプライン」Ⅱ-170〜171
 *       計画最大流量時の水理計算書（φ600 ダクタイル鋳鉄管、C=130、Q=451.50 L/s）
 *       静水位: ○○吐水槽 H.W.L = 580.600 m
 *
 * 全31測点（IP.161〜IP.189 + No67+80, IP.69+0）を記載例どおりに収録。
 */

import type { MeasurementPoint } from "@open-waterhammer/core";

/** 成果品様式記載例 水理計算書の全測点データ（31点） */
export const DEMO_MEASUREMENT_POINTS: MeasurementPoint[] = [
  // ID,          Lh,      GL,      FH,       SL,      Q(m³/s), D(m),  C,   fb,    fv, fβ
  { id: "IP.161", horizontalDistance: 25.776, groundLevel: 477.20, pipeCenterHeight: 475.533, pipeLength: 25.874, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.162", horizontalDistance:  9.000, groundLevel: 478.01, pipeCenterHeight: 476.402, pipeLength:  9.033, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.163", horizontalDistance:  7.583, groundLevel: 478.71, pipeCenterHeight: 477.050, pipeLength:  7.611, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.164", horizontalDistance: 16.810, groundLevel: 480.32, pipeCenterHeight: 478.625, pipeLength: 16.884, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.165", horizontalDistance:  9.957, groundLevel: 481.43, pipeCenterHeight: 479.557, pipeLength: 10.001, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.166", horizontalDistance: 12.607, groundLevel: 482.38, pipeCenterHeight: 480.738, pipeLength: 12.662, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.167", horizontalDistance:  9.200, groundLevel: 483.16, pipeCenterHeight: 481.600, pipeLength:  9.240, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.168", horizontalDistance:  8.812, groundLevel: 484.11, pipeCenterHeight: 482.313, pipeLength:  8.841, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.169", horizontalDistance: 12.355, groundLevel: 485.14, pipeCenterHeight: 483.313, pipeLength: 12.395, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.170", horizontalDistance: 17.148, groundLevel: 486.24, pipeCenterHeight: 484.700, pipeLength: 17.204, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.171", horizontalDistance: 10.400, groundLevel: 486.77, pipeCenterHeight: 485.225, pipeLength: 10.413, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.059, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.172", horizontalDistance: 10.811, groundLevel: 487.34, pipeCenterHeight: 485.771, pipeLength: 10.825, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.173", horizontalDistance:  9.566, groundLevel: 487.95, pipeCenterHeight: 485.254, pipeLength:  9.578, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.174", horizontalDistance:  7.866, groundLevel: 488.46, pipeCenterHeight: 486.651, pipeLength:  7.876, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.175", horizontalDistance: 11.866, groundLevel: 489.01, pipeCenterHeight: 487.250, pipeLength: 11.881, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.176", horizontalDistance: 13.065, groundLevel: 489.69, pipeCenterHeight: 488.092, pipeLength: 13.092, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.177", horizontalDistance: 13.032, groundLevel: 490.51, pipeCenterHeight: 488.933, pipeLength: 13.059, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.178", horizontalDistance: 11.128, groundLevel: 491.22, pipeCenterHeight: 489.650, pipeLength: 11.151, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.179", horizontalDistance: 31.258, groundLevel: 493.10, pipeCenterHeight: 491.368, pipeLength: 31.305, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.180", horizontalDistance: 12.402, groundLevel: 493.72, pipeCenterHeight: 492.050, pipeLength: 12.421, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.181", horizontalDistance: 25.282, groundLevel: 495.22, pipeCenterHeight: 493.703, pipeLength: 25.336, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.182", horizontalDistance: 16.007, groundLevel: 496.41, pipeCenterHeight: 494.750, pipeLength: 16.041, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.183", horizontalDistance: 14.343, groundLevel: 496.80, pipeCenterHeight: 495.275, pipeLength: 14.353, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "No67+80", horizontalDistance: 10.268, groundLevel: 497.20, pipeCenterHeight: 495.650, pipeLength: 10.275, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.184", horizontalDistance: 19.650, groundLevel: 498.95, pipeCenterHeight: 497.401, pipeLength: 19.728, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.185", horizontalDistance:  8.963, groundLevel: 499.76, pipeCenterHeight: 498.200, pipeLength:  8.999, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.186", horizontalDistance: 35.058, groundLevel: 502.02, pipeCenterHeight: 500.395, pipeLength: 35.127, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.187", horizontalDistance: 14.449, groundLevel: 502.88, pipeCenterHeight: 501.300, pipeLength: 14.477, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.188", horizontalDistance: 11.429, groundLevel: 503.38, pipeCenterHeight: 501.445, pipeLength: 11.430, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.69+0", horizontalDistance: 30.451, groundLevel: 503.73, pipeCenterHeight: 501.830, pipeLength: 30.453, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.006, valveLossCoeff: 0, branchLossCoeff: 0 },
  { id: "IP.189", horizontalDistance: 16.540, groundLevel: 503.06, pipeCenterHeight: 501.030, pipeLength: 15.659, flowRate: 0.4515, diameter: 0.600, roughnessC: 130, bendLossCoeff: 0.016, valveLossCoeff: 0, branchLossCoeff: 0 },
];

/** 成果品様式記載例の静水位 [m] */
export const DEMO_STATIC_WATER_LEVEL = 580.600;

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

準拠: 土地改良設計基準パイプライン（令和3年6月改訂）第5章
`.trim();
