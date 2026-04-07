/**
 * 定常→非定常 接続モジュール
 *
 * 縦断水理計算（定常）の結果を、特性曲線法（MOC）の初期条件に変換する。
 * 要旨 §3.2(2): 定常計算部の結果から非定常解析の初期条件を与える。
 */

import { calcWaveSpeed } from "./formulas.js";
import type { Pipe, PipeType, MeasurementPoint } from "./types.js";
import type { LongitudinalHydraulicResult, MeasurementPointResult } from "./types.js";
import type {
  MocNetwork,
  MocPipeSegment,
  MocOptions,
  BoundaryCondition,
  ValveBC,
  ReservoirBC,
  PumpBC,
} from "./moc.js";

// ─── 入力型 ─────────────────────────────────────────────────────────────────

/** 管種・管厚の指定（全区間共通 or 区間別） */
export interface PipeMaterialSpec {
  pipeType: PipeType;
  /** 管厚 [m] — 省略時は内径の 1/20 で仮定 */
  wallThickness?: number;
  /** ヤング係数 [kN/m²] — 省略時は管種から自動参照 */
  youngsModulus?: number;
}

/** 定常→MOC 変換の入力 */
export interface SteadyToMocInput {
  /** 縦断水理計算の結果 */
  hydraulicResult: LongitudinalHydraulicResult;
  /** 測点データ（元データ） */
  points: MeasurementPoint[];
  /** 管種・管厚（全区間共通） */
  material: PipeMaterialSpec;
  /** 上流端の境界条件（デフォルト: 貯水槽＝静水位） */
  upstreamBC?: BoundaryCondition;
  /** 下流端の境界条件（デフォルト: バルブ閉鎖） */
  downstreamBC?: BoundaryCondition;
  /** バルブ閉鎖時間 [s]（downstreamBC省略時に使用、デフォルト: 振動周期T₀で瞬時閉） */
  valveCloseTime?: number;
  /** MOC 管路分割数（デフォルト: 10） */
  nReaches?: number;
  /** シミュレーション時間 [s] */
  tMax?: number;
}

/** 定常→MOC 変換の出力 */
export interface SteadyToMocOutput {
  network: MocNetwork;
  options: MocOptions;
  /** 変換時の情報 */
  summary: {
    /** MOC管路セグメント数 */
    segmentCount: number;
    /** 全管路延長 [m] */
    totalLength: number;
    /** 初期流量 Q₀ [m³/s] */
    initialFlow: number;
    /** 上流端水頭 [m] */
    upstreamHead: number;
    /** 波速 a [m/s]（代表値） */
    representativeWaveSpeed: number;
    /** 振動周期 T₀ [s] */
    vibrationPeriod: number;
  };
}

// ─── 変換ロジック ────────────────────────────────────────────────────────────

/**
 * 縦断水理計算結果をMOCネットワークに変換
 *
 * 連続する測点を、管径が同一の区間ごとにグループ化して
 * MOC管路セグメントとする。各セグメントの初期流量・初期水頭は
 * 定常計算の結果から設定する。
 */
export function buildMocFromSteady(input: SteadyToMocInput): SteadyToMocOutput {
  const {
    hydraulicResult,
    points,
    material,
    nReaches = 10,
    tMax,
  } = input;

  const results = hydraulicResult.pointResults;
  if (points.length < 2 || results.length < 2) {
    throw new Error("MOC変換には2測点以上が必要です");
  }
  if (points.length !== results.length) {
    throw new Error("測点数と結果数が一致しません");
  }

  // 管径が同一の連続測点をグループ化してセグメントにする
  const segments = groupIntoSegments(points, results, material, nReaches);

  // 初期流量（最初の測点の流量）
  const Q0 = points[0]!.flowRate;

  // 上流端水頭 = 静水位
  const upstreamHead = hydraulicResult.staticWaterLevel;

  // 代表波速（最初のセグメントの値）
  const representativeWaveSpeed = segments[0]!.waveSpeed;

  // 全管路延長
  const totalLength = segments.reduce((sum, s) => sum + s.pipe.length, 0);

  // 振動周期
  const vibrationPeriod = 4 * totalLength / representativeWaveSpeed;

  // 境界条件
  const upstreamNodeId = "node_0";
  const downstreamNodeId = `node_${segments.length}`;

  const upstreamBC: BoundaryCondition = input.upstreamBC ?? {
    type: "reservoir" as const,
    head: upstreamHead,
  };

  const downstreamBC: BoundaryCondition = input.downstreamBC ?? buildDefaultValveBC(
    Q0,
    results[results.length - 1]!.hydraulicGradeLine,
    input.valveCloseTime,
    vibrationPeriod,
  );

  // ノードIDを付与
  const mocPipes: MocPipeSegment[] = segments.map((seg, i) => ({
    ...seg,
    upstreamNodeId: `node_${i}`,
    downstreamNodeId: `node_${i + 1}`,
  }));

  const nodes: Record<string, BoundaryCondition> = {
    [upstreamNodeId]: upstreamBC,
    [downstreamNodeId]: downstreamBC,
  };

  const network: MocNetwork = { pipes: mocPipes, nodes };

  const options: MocOptions = {};
  if (tMax !== undefined) options.tMax = tMax;
  options.initialFlow = Q0;

  return {
    network,
    options,
    summary: {
      segmentCount: segments.length,
      totalLength,
      initialFlow: Q0,
      upstreamHead,
      representativeWaveSpeed,
      vibrationPeriod,
    },
  };
}

// ─── 内部ヘルパー ────────────────────────────────────────────────────────────

interface SegmentDraft {
  id: string;
  pipe: Pipe;
  waveSpeed: number;
  nReaches: number;
  initialFlow?: number;
  upstreamNodeId: string;
  downstreamNodeId: string;
}

/**
 * 測点列を管径の変化点でグループ化し、MOCセグメントを生成
 */
function groupIntoSegments(
  points: MeasurementPoint[],
  results: MeasurementPointResult[],
  material: PipeMaterialSpec,
  nReaches: number,
): SegmentDraft[] {
  const segments: SegmentDraft[] = [];
  let segStart = 0;

  for (let i = 1; i <= points.length; i++) {
    // 管径変化点またはリストの終端でセグメントを区切る
    const diameterChanged = i < points.length &&
      Math.abs(points[i]!.diameter - points[segStart]!.diameter) > 0.0001;
    const isEnd = i === points.length;

    if (diameterChanged || isEnd) {
      const endIdx = isEnd ? i - 1 : i - 1;
      const segPoints = points.slice(segStart, endIdx + 1);
      const diameter = points[segStart]!.diameter;
      const roughnessC = points[segStart]!.roughnessC;
      const wallThickness = material.wallThickness ?? (diameter / 20);

      // 区間の管路延長 = 各測点の管長の合計（最初の測点を除く）
      const segLength = segPoints.reduce((sum, pt, j) => {
        if (j === 0 && segStart === 0) return sum; // 最初の測点は始点
        return sum + pt.pipeLength;
      }, 0);

      // Pipe オブジェクト
      const pipe: Pipe = {
        id: `seg_${segments.length}`,
        startNodeId: "", // 後で設定
        endNodeId: "",
        pipeType: material.pipeType,
        innerDiameter: diameter,
        wallThickness,
        length: segLength > 0 ? segLength : segPoints[0]!.pipeLength,
        roughnessCoeff: roughnessC,
        ...(material.youngsModulus !== undefined && { youngsModulus: material.youngsModulus }),
      };

      const waveSpeed = calcWaveSpeed(pipe);

      segments.push({
        id: `seg_${segments.length}`,
        pipe,
        waveSpeed,
        nReaches,
        initialFlow: points[segStart]!.flowRate,
        upstreamNodeId: "",
        downstreamNodeId: "",
      });

      if (diameterChanged) {
        segStart = i;
      }
    }
  }

  return segments;
}

/**
 * デフォルトのバルブBC（下流端閉鎖）を生成
 */
function buildDefaultValveBC(
  Q0: number,
  H0v: number,
  closeTime: number | undefined,
  vibrationPeriod: number,
): ValveBC {
  return {
    type: "valve",
    Q0,
    H0v,
    // 閉鎖時間が未指定の場合は振動周期の半分（瞬時閉に近い条件）
    closeTime: closeTime ?? vibrationPeriod / 2,
    operation: "close",
  };
}

/**
 * ポンプ圧送系用: 上流BCをポンプに変更するヘルパー
 */
export function buildPumpUpstreamBC(params: {
  Q0: number;
  pumpHead: number;
  Hs?: number;
  GD2?: number;
  N0?: number;
  eta0?: number;
  shutdownTime?: number;
  checkValve?: boolean;
}): PumpBC {
  return {
    type: "pump",
    Q0: params.Q0,
    H0: params.pumpHead,
    ...(params.Hs !== undefined && { Hs: params.Hs }),
    ...(params.GD2 !== undefined && { GD2: params.GD2 }),
    ...(params.N0 !== undefined && { N0: params.N0 }),
    ...(params.eta0 !== undefined && { eta0: params.eta0 }),
    shutdownTime: params.shutdownTime ?? 0,
    checkValve: params.checkValve ?? true,
    mode: "trip" as const,
  };
}
