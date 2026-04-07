/**
 * 計算セッション管理
 *
 * 要旨 §3.2(6): 入力条件・計算条件・出力結果・更新履歴を一体的に保存し、
 *              再計算時に差分を確認できるようにする。
 * 要旨 §3.3:   入力条件表・計算条件表・結果整理表を相互に対応づけて管理。
 */

import type { Pipe, MeasurementPoint } from "./types.js";
import type {
  LongitudinalHydraulicInput,
  LongitudinalHydraulicResult,
} from "./types.js";
import type { MocNetwork, MocOptions, MocResult } from "./moc.js";
import type { PipeMaterialSpec } from "./steady-to-moc.js";

// ─── セッション型 ────────────────────────────────────────────────────────────

/** 計算セッション: 入力条件・計算設定・結果を一体管理する単位 */
export interface CalculationSession {
  /** 一意識別子 */
  id: string;
  /** セッション名 */
  name: string;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 最終更新日時 (ISO 8601) */
  updatedAt: string;
  /** 説明・メモ */
  description?: string;

  // --- 入力条件 ---

  /** 管路諸元 */
  pipes: Pipe[];
  /** 測点データ */
  measurementPoints: MeasurementPoint[];
  /** 管種・管厚（波速算定用） */
  material?: PipeMaterialSpec;

  // --- 定常計算 ---

  /** 定常計算の入力パラメータ */
  steadyInput?: LongitudinalHydraulicInput;
  /** 定常計算の結果 */
  steadyResult?: LongitudinalHydraulicResult;

  // --- 非定常解析 ---

  /** MOC ネットワーク定義 */
  mocNetwork?: MocNetwork;
  /** MOC オプション */
  mocOptions?: MocOptions;
  /** MOC 結果サマリー（時系列データは大きいため要約のみ保存） */
  mocSummary?: MocResultSummary;

  // --- 変更履歴 ---

  /** 条件変更の履歴 */
  changes: SessionChange[];
}

/** MOC結果の要約（保存用） */
export interface MocResultSummary {
  dt: number;
  tMax: number;
  /** 管路ごとの最大・最小水頭 */
  pipeEnvelopes: Record<string, {
    Hmax: number[];
    Hmin: number[];
    waveSpeed: number;
    vibrationPeriod: number;
  }>;
  /** 節点ごとの最大・最小水頭 */
  nodeExtremes: Record<string, {
    maxH: number;
    minH: number;
  }>;
}

/** 条件変更の記録 */
export interface SessionChange {
  /** 変更日時 (ISO 8601) */
  timestamp: string;
  /** 変更カテゴリ */
  category: "input" | "steady" | "moc" | "meta";
  /** 変更対象フィールドのパス（例: "measurementPoints[3].diameter"） */
  field: string;
  /** 変更前の値（JSON文字列化） */
  oldValue?: string;
  /** 変更後の値（JSON文字列化） */
  newValue?: string;
  /** 変更の説明 */
  description?: string;
}

// ─── セッション操作 ──────────────────────────────────────────────────────────

/** 新規セッションを作成 */
export function createSession(params: {
  name: string;
  pipes?: Pipe[];
  measurementPoints?: MeasurementPoint[];
  description?: string;
}): CalculationSession {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: params.name,
    createdAt: now,
    updatedAt: now,
    ...(params.description !== undefined && { description: params.description }),
    pipes: params.pipes ?? [],
    measurementPoints: params.measurementPoints ?? [],
    changes: [{
      timestamp: now,
      category: "meta",
      field: "session",
      description: "セッション作成",
    }],
  };
}

/** セッションに変更を記録 */
export function recordChange(
  session: CalculationSession,
  change: Omit<SessionChange, "timestamp">,
): CalculationSession {
  const now = new Date().toISOString();
  return {
    ...session,
    updatedAt: now,
    changes: [...session.changes, { ...change, timestamp: now }],
  };
}

/** MOC結果をサマリーに変換（保存用に軽量化） */
export function summarizeMocResult(result: MocResult): MocResultSummary {
  const pipeEnvelopes: MocResultSummary["pipeEnvelopes"] = {};
  for (const [id, pipe] of Object.entries(result.pipes)) {
    pipeEnvelopes[id] = {
      Hmax: pipe.Hmax,
      Hmin: pipe.Hmin,
      waveSpeed: pipe.waveSpeed,
      vibrationPeriod: pipe.vibrationPeriod,
    };
  }
  const nodeExtremes: MocResultSummary["nodeExtremes"] = {};
  for (const [id, node] of Object.entries(result.nodes)) {
    const heads = node.H.map(h => h.H);
    nodeExtremes[id] = {
      maxH: Math.max(...heads),
      minH: Math.min(...heads),
    };
  }
  return { dt: result.dt, tMax: result.tMax, pipeEnvelopes, nodeExtremes };
}

// ─── セッション差分比較 ──────────────────────────────────────────────────────

/** 差分の1項目 */
export interface SessionDiffItem {
  category: "input" | "steady" | "moc" | "meta";
  field: string;
  label: string;
  valueA?: string;
  valueB?: string;
  changed: boolean;
}

/** 2つのセッションの主要条件を比較 */
export function diffSessions(a: CalculationSession, b: CalculationSession): SessionDiffItem[] {
  const diffs: SessionDiffItem[] = [];

  // メタ情報
  addDiff(diffs, "meta", "name", "セッション名", a.name, b.name);

  // 管路諸元
  addDiff(diffs, "input", "pipes.length", "管路数", String(a.pipes.length), String(b.pipes.length));
  addDiff(diffs, "input", "measurementPoints.length", "測点数",
    String(a.measurementPoints.length), String(b.measurementPoints.length));

  // 管種
  addDiff(diffs, "input", "material.pipeType", "管種",
    a.material?.pipeType ?? "未設定", b.material?.pipeType ?? "未設定");

  // 定常計算条件
  addDiff(diffs, "steady", "staticWaterLevel", "静水位 [m]",
    a.steadyInput?.staticWaterLevel?.toFixed(3) ?? "未計算",
    b.steadyInput?.staticWaterLevel?.toFixed(3) ?? "未計算");
  addDiff(diffs, "steady", "caseName", "ケース名",
    a.steadyInput?.caseName ?? "未設定", b.steadyInput?.caseName ?? "未設定");

  // 定常計算結果
  addDiff(diffs, "steady", "maxVelocity", "最大流速 [m/s]",
    a.steadyResult?.maxVelocity?.toFixed(2) ?? "—",
    b.steadyResult?.maxVelocity?.toFixed(2) ?? "—");
  addDiff(diffs, "steady", "maxDesignPressure", "最大設計内圧 [MPa]",
    a.steadyResult?.maxDesignPressure?.toFixed(2) ?? "—",
    b.steadyResult?.maxDesignPressure?.toFixed(2) ?? "—");

  // MOC条件
  addDiff(diffs, "moc", "tMax", "シミュレーション時間 [s]",
    a.mocSummary?.tMax?.toFixed(2) ?? "—",
    b.mocSummary?.tMax?.toFixed(2) ?? "—");

  // MOC結果: 各管路の最大水頭
  const allPipeIds = new Set([
    ...Object.keys(a.mocSummary?.pipeEnvelopes ?? {}),
    ...Object.keys(b.mocSummary?.pipeEnvelopes ?? {}),
  ]);
  for (const pid of allPipeIds) {
    const aMax = a.mocSummary?.pipeEnvelopes[pid]?.Hmax;
    const bMax = b.mocSummary?.pipeEnvelopes[pid]?.Hmax;
    addDiff(diffs, "moc", `pipe.${pid}.Hmax`, `${pid} 最大水頭 [m]`,
      aMax ? Math.max(...aMax).toFixed(2) : "—",
      bMax ? Math.max(...bMax).toFixed(2) : "—");
    const aMin = a.mocSummary?.pipeEnvelopes[pid]?.Hmin;
    const bMin = b.mocSummary?.pipeEnvelopes[pid]?.Hmin;
    addDiff(diffs, "moc", `pipe.${pid}.Hmin`, `${pid} 最小水頭 [m]`,
      aMin ? Math.min(...aMin).toFixed(2) : "—",
      bMin ? Math.min(...bMin).toFixed(2) : "—");
  }

  // 測点ごとの管径比較（管径変更は影響が大きいため）
  const maxPts = Math.max(a.measurementPoints.length, b.measurementPoints.length);
  for (let i = 0; i < maxPts; i++) {
    const ptA = a.measurementPoints[i];
    const ptB = b.measurementPoints[i];
    if (!ptA || !ptB) continue;
    if (Math.abs(ptA.diameter - ptB.diameter) > 0.0001) {
      addDiff(diffs, "input", `point[${i}].diameter`, `${ptA.id} 管径 [m]`,
        ptA.diameter.toFixed(3), ptB.diameter.toFixed(3));
    }
    if (Math.abs(ptA.flowRate - ptB.flowRate) > 0.00001) {
      addDiff(diffs, "input", `point[${i}].flowRate`, `${ptA.id} 流量 [m3/s]`,
        ptA.flowRate.toFixed(5), ptB.flowRate.toFixed(5));
    }
  }

  return diffs;
}

function addDiff(
  diffs: SessionDiffItem[],
  category: SessionDiffItem["category"],
  field: string,
  label: string,
  valueA: string,
  valueB: string,
) {
  diffs.push({ category, field, label, valueA, valueB, changed: valueA !== valueB });
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
