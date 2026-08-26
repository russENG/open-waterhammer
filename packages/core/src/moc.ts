/**
 * 特性曲線法（Method of Characteristics）汎用水撃圧非定常計算エンジン
 *
 * 対応シナリオ:
 *   - バルブ急閉・緩閉・急開・緩開（線形等価操作時間）
 *   - ポンプ急停止（GD²慣性方程式 または 線形近似フォールバック）
 *   - ポンプ起動（線形速度上昇）
 *   - 複数管路直列・T字/Y字分岐
 *   - エアチャンバ（圧力タンク・ポリトロープ気体則）
 *   - サージタンク（調圧水槽・水位ODE）
 *   - 吸気弁（負圧開放弁）
 *   - 減圧バルブ（設定圧維持）
 *
 * 摩擦モデル: ハーゼン・ウィリアムス式 → Darcy-Weisbach 等価、局所可変（各ノード・各ステップ）
 * 時間積分: 陽的差分（クーラン条件 CFL=1: Δt = Δx/a）
 *           ※技術書 式(8.4.8) は Δt ≤ Δx/(V+a) であり、V<<a（通常 V/a≦0.001）の
 *             仮定下で常に安全側。runMoc は V を含めた厳密チェックも warning で報告。
 *
 * 出典: 土地改良設計基準パイプライン技術書 §8.4（特性曲線法）
 *       Wylie & Streeter "Fluid Transients in Systems" (1993)
 *
 * 【簡略化事項】
 *   ポンプ完全特性（四象限）: 放物線近似 H = α²Hs - BqQ²（通常運転域）
 *   逆転領域は逆止め弁 or Q=0 近似。精密解析はポンプメーカー完全特性データが必要。
 */

import type { Pipe } from "./types.js";
import { GRAVITY } from "./formulas.js";

/** 技術書 §8.4.2(2): 設計用水撃圧解析で一般に用いられる差分距離 [m] */
export const MOC_GRID_SPACING_RECOMMENDED_MIN = 50;
/** 技術書 §8.4.2(2): 本ソルバーが設計用途で許容する最大差分距離 [m] */
export const MOC_GRID_SPACING_MAX = 200;

/**
 * 水蒸気圧水頭（ゲージ、標高0m・常温）[m]
 *
 * これを下回ると水柱分離（キャビテーション）が発生する。本ソルバーは分離後の
 * 挙動を追跡しないため、下回った場合は警告を返す（issue #50）。
 * 標高が高い現場や水温が高い場合は `MocOptions.vaporPressureHead` で調整する。
 */
export const MOC_VAPOR_PRESSURE_HEAD = -10.33;

// ═══════════════════════════════════════════════════════════════════════════════
// 境界条件型（Discriminated Union）
// ═══════════════════════════════════════════════════════════════════════════════

/** 定水頭貯水槽（上流・下流どちらにも配置可） */
export interface ReservoirBC {
  type: "reservoir";
  /** 水頭 H_R [m] */
  head: number;
}

/**
 * バルブ（末端・中間どちらでも可）
 * 線形開度変化: close → 1→0、open → 0→1
 * 技術書 §8.3.1(1)b 均等操作（等価閉そく時間）に対応
 */
export interface ValveBC {
  type: "valve";
  /** 初期流量 Q₀ [m³/s] */
  Q0: number;
  /** バルブ端初期水頭 H₀ [m] */
  H0v: number;
  /** 操作完了時間 tν [s]（0 = 瞬時） */
  closeTime: number;
  /** "close"（デフォルト）or "open" */
  operation?: "close" | "open";
}

/**
 * ポンプ（上流端専用）
 * H-Q 特性: H_pump = α²·Hs - Bq·Q²（放物線近似）
 *
 * 回転速度モデル:
 *   GD2 + N0 を指定した場合 → 技術書式(8.4.10-11) GD²慣性方程式
 *   未指定の場合 → 線形近似: trip: α=max(0,1-t/shutdownTime)、start: α=min(1,t/startupTime)
 *
 * 逆止め弁 checkValve=true のとき Q < 0 を遮断
 */
export interface PumpBC {
  type: "pump";
  /** 定格流量 Q₀ [m³/s] */
  Q0: number;
  /** 定格水頭（揚程）H₀ [m] */
  H0: number;
  /** 締切水頭 Hs [m]（Q=0 時の揚程、デフォルト 1.2×H₀） */
  Hs?: number;
  /**
   * GD²（はずみ車効果）[N·m²]
   * 指定時は技術書式(8.4.10-11) によるGD²慣性方程式を使用
   */
  GD2?: number;
  /** 定格回転速度 N₀ [min⁻¹]（GD2 使用時に必要） */
  N0?: number;
  /** 定格効率 η₀（デフォルト 0.80） */
  eta0?: number;
  /** 停止完了時間 t_decel [s]（GD2 未指定時の線形フォールバック） */
  shutdownTime: number;
  /** 動作モード: "trip"（急停止、デフォルト）or "start"（起動） */
  mode?: "trip" | "start";
  /** 起動完了時間 [s]（mode="start" 時に使用） */
  startupTime?: number;
  /** 起動前の静水頭 [m]（mode="start" 時の初期管内圧力、デフォルト 0） */
  staticHead?: number;
  /** 逆止め弁（デフォルト true） */
  checkValve?: boolean;
}

/**
 * エアチャンバ（圧力タンク）
 * 技術書 §8.3 表-8.3.1「圧力タンク」境界条件
 * 気体則: H_a · V_a^m = const（ポリトロープ）
 */
export interface AirChamberBC {
  type: "air_chamber";
  /** 初期空気容積 V_a0 [m³] */
  V_air0: number;
  /** 初期水頭（システム静圧）H_a0 [m] */
  H_air0: number;
  /** ポリトロープ指数 m（等温=1.0、断熱=1.4、実用≈1.2） */
  polytropicIndex?: number;
}

/**
 * サージタンク（調圧水槽）
 * 技術書 §8.5 剛体理論解析の主対象境界条件
 * 水位 ODE: A_s·dz/dt = Q_in（陰的更新で無条件安定）
 */
export interface SurgeTankBC {
  type: "surge_tank";
  /** タンク断面積 A_s [m²] */
  tankArea: number;
  /** 初期水位 z₀ [m]（datum からの高さ） */
  initialLevel: number;
  /** 基準高さ datum [m]（デフォルト 0） */
  datum?: number;
}

/**
 * 吸気弁（Air Release / Vacuum Breaking Valve）
 * 技術書 §8.3 負圧防止対策
 * H < H_atm になると開放し大気圧を維持
 */
export interface AirReleaseValveBC {
  type: "air_release_valve";
  /** 大気圧水頭 [m]（デフォルト 10.33 m ≈ 101.3 kPa） */
  atmosphericHead?: number;
}

/**
 * 減圧バルブ（Pressure Reducing Valve）
 * 技術書 §8.3 表-8.3.1「減圧バルブ」
 * 下流側圧力を設定値 H_set に維持
 */
export interface PressureReducingValveBC {
  type: "pressure_reducing_valve";
  /** 目標下流圧水頭 H_set [m] */
  setHead: number;
  /** 初期流量 Q₀ [m³/s] */
  Q0: number;
}

/** 行き止まり（Q=0 の剛体端、下流端専用） */
export interface DeadEndBC {
  type: "dead_end";
}

export type BoundaryCondition =
  | ReservoirBC
  | ValveBC
  | PumpBC
  | AirChamberBC
  | SurgeTankBC
  | AirReleaseValveBC
  | PressureReducingValveBC
  | DeadEndBC;

// ═══════════════════════════════════════════════════════════════════════════════
// 管網型
// ═══════════════════════════════════════════════════════════════════════════════

/** 管路区間 */
export interface MocPipeSegment {
  /** 管路 ID（結果の key に使用） */
  id: string;
  pipe: Pipe;
  /** 波速 a [m/s] */
  waveSpeed: number;
  /** 分割数 N（Δt = Δx/a） */
  nReaches: number;
  /** 上流節点 ID */
  upstreamNodeId: string;
  /** 下流節点 ID */
  downstreamNodeId: string;
  /**
   * 初期流量 [m³/s]（分岐管路時に各管路の流量を個別指定）
   * 省略時は options.initialFlow または下流 BC から推算
   */
  initialFlow?: number;
  /**
   * 上流端の管中心高 [m]（issue #50: 水柱分離の判定に使う）
   *
   * 水柱分離は**動水頭**（水頭 − 管中心高）が水蒸気圧水頭を下回ったときに起きる。
   * 省略すると 0 とみなし、水頭をそのまま動水頭として判定する（＝基準面が
   * 管中心にある場合のみ正しい）。標高差のある管路では必ず指定すること。
   */
  upstreamElevation?: number;
  /** 下流端の管中心高 [m]（省略時 0。管中心高は上下流端の直線補間とする） */
  downstreamElevation?: number;
}

/**
 * 管網定義
 * 直列・分岐管路に対応（pipes は上流→下流の順に並べること）
 */
export interface MocNetwork {
  pipes: MocPipeSegment[];
  /** 境界節点の条件（内部接続節点は自動的に連続条件を適用） */
  nodes: Record<string, BoundaryCondition>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 入出力型
// ═══════════════════════════════════════════════════════════════════════════════

export interface MocOptions {
  /** シミュレーション時間 [s]（デフォルト: 最長管路の T₀ × 3） */
  tMax?: number;
  /** 全管路共通の初期流量 Q₀ [m³/s]（省略時は各管路 BC から推算） */
  initialFlow?: number;
  /** 定常計算から引き継ぐ節点水頭 [m] */
  initialNodeHeads?: Record<string, number>;
  /**
   * 水柱分離を判定する水蒸気圧水頭（ゲージ）[m]
   * 既定 `MOC_VAPOR_PRESSURE_HEAD`（-10.33 m）。下回ると警告を返す。
   */
  vaporPressureHead?: number;
}

export interface MocSnapshot {
  t: number;
  H: number[];
  Q: number[];
}

export interface MocPipeResult {
  waveSpeed: number;
  dx: number;
  nReaches: number;
  vibrationPeriod: number;
  H_steady: number[];
  Hmax: number[];
  Hmin: number[];
  /** 間引きスナップショット（最大 200 点） */
  snapshots: MocSnapshot[];
}

export interface MocNodeResult {
  /** 節点水頭時系列 */
  H: { t: number; H: number }[];
  /** ポンプ節点: 回転速度時系列 [min⁻¹] */
  N?: { t: number; N: number }[];
  /** エアチャンバ節点: 空気容積時系列 [m³] */
  V_air?: { t: number; V: number }[];
  /** サージタンク節点: 水位時系列 [m] */
  z?: { t: number; z: number }[];
}

export interface MocResult {
  dt: number;
  tMax: number;
  pipes: Record<string, MocPipeResult>;
  nodes: Record<string, MocNodeResult>;
  /** ソルバーが生成した警告（dt整合化など） */
  warnings?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 内部ヘルパー
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 全管路の Δt を統一し、nReaches を再計算する（技術書 §8.4.2(2) 表-8.4.1）
 *
 * 各管路の素の Δt_i = L_i/(a_i·N_i^init) から最小値を共通 Δt として採用し、
 * 各管路の N_i を round(L_i/(a_i·Δt)) で再計算する。これにより
 * 全管路で dx/(a·dt) ≒ 1 が成立し、特性線が格子点を正しく通る。
 *
 * 再調整による Δx の相対誤差が大きい場合（>5%）は警告を返す。
 */
export function harmonizeTimeStep(segs: MocPipeSegment[]): {
  segs: MocPipeSegment[];
  dt: number;
  warnings: string[];
} {
  if (segs.length === 0) return { segs, dt: 0, warnings: [] };
  const warnings: string[] = [];

  const dtCandidates = segs.map((s) => s.pipe.length / (s.waveSpeed * Math.max(1, s.nReaches)));
  const dt = Math.min(...dtCandidates);

  const harmonized = segs.map((s) => {
    const N_ideal = s.pipe.length / (s.waveSpeed * dt);
    const N_new = Math.max(1, Math.round(N_ideal));
    const dx_new = s.pipe.length / N_new;
    const dx_ideal = s.waveSpeed * dt;
    const relErr = Math.abs(dx_new - dx_ideal) / dx_ideal;
    if (relErr > 0.05) {
      warnings.push(
        `${s.id}: dt整合化で nReaches=${s.nReaches}→${N_new}、`
        + `Δx の理想値からの誤差 ${(relErr * 100).toFixed(1)}%（CFL<1）。`
        + `特性線の足を格子間で補間します。`,
      );
    } else if (N_new !== s.nReaches) {
      warnings.push(`${s.id}: dt整合化で nReaches=${s.nReaches}→${N_new}（誤差 ${(relErr * 100).toFixed(2)}%）`);
    }
    return { ...s, nReaches: N_new };
  });

  return { segs: harmonized, dt, warnings };
}

// ─── 計算区間数の自動提案（issue #49）────────────────────────────────────────

/** `suggestReaches` の入力（管路 1 本ぶんの最小情報） */
export interface ReachCandidatePipe {
  /** 管路延長 L [m] */
  length: number;
  /** 波速 a [m/s] */
  waveSpeed: number;
}

export interface SuggestReachesOptions {
  /** 差分距離の下限 [m]（既定 `MOC_GRID_SPACING_RECOMMENDED_MIN` = 50） */
  dxMin?: number;
  /** 差分距離の上限 [m]（既定 `MOC_GRID_SPACING_MAX` = 200） */
  dxMax?: number;
  /** 目標とする差分距離 [m]（既定 100 = 実務目安の中央） */
  dxTarget?: number;
  /**
   * 許容する Courant 誤差（既定 0.01 = 1%）
   *
   * `harmonizeTimeStep` は 5% 超で警告を出す。既定値はそれより十分厳しく、かつ
   * Δx を不必要に細かくしない水準として 1% をとっている。
   */
  courantTolerance?: number;
}

export interface SuggestReachesResult {
  /** 各管路の計算区間数（入力と同じ順） */
  reaches: number[];
  /** 共通タイムステップ Δt [s] */
  dt: number;
  /** 全管路で最大の Courant 誤差 |Δx − a·Δt| / (a·Δt) */
  courantError: number;
  /** 実際に採用した差分距離の下限 [m] */
  dxMin: number;
  /** 実務目安を外れた場合などの説明 */
  warnings: string[];
}

/** 指定した Δx 下限のもとで最良の分割数の組を探す */
function searchReaches(
  pipes: ReachCandidatePipe[], dxMin: number, dxMax: number, dxTarget: number, tolerance: number,
): { reaches: number[]; dt: number; courantError: number } | null {
  const first = pipes[0]!;
  const nMax = Math.max(1, Math.ceil(first.length / dxMin));
  let best: { reaches: number[]; dt: number; err: number; rank: [number, number] } | null = null;

  for (let n0 = 1; n0 <= nMax; n0++) {
    const dtSeed = first.length / (first.waveSpeed * n0);
    const reaches = pipes.map((p) => Math.max(1, Math.round(p.length / (p.waveSpeed * dtSeed))));
    // 実際に runMoc（harmonizeTimeStep）が採用する Δt は各管路の素の Δt の最小値。
    // 誤差評価もそれに合わせないと提案値とソルバーの挙動がずれる。
    const dt = Math.min(...pipes.map((p, i) => p.length / (p.waveSpeed * reaches[i]!)));
    let err = 0;
    let dxPenalty = 0;
    let ok = true;
    for (let i = 0; i < pipes.length; i++) {
      const dx = pipes[i]!.length / reaches[i]!;
      if (dx > dxMax || dx < dxMin) { ok = false; break; }
      err = Math.max(err, Math.abs(dx - pipes[i]!.waveSpeed * dt) / (pipes[i]!.waveSpeed * dt));
      dxPenalty = Math.max(dxPenalty, Math.abs(dx - dxTarget));
    }
    if (!ok) continue;
    // 許容内の誤差は実用上等価とみなし、Δx が目標に近い（＝計算量が妥当な）組を優先する
    const rank: [number, number] = err <= tolerance ? [0, dxPenalty] : [1, err];
    if (best === null || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) {
      best = { reaches, dt, err, rank };
    }
  }
  return best === null ? null : { reaches: best.reaches, dt: best.dt, courantError: best.err };
}

/**
 * 全管路で共通の Δt が成立する計算区間数の組を提案する（技術書 §8.4.2(2)）
 *
 * MOC は全管路で共通の Δt を使うため、Δx = a·Δt が全管路で同時に成り立つ分割数を
 * 選ぶ必要がある。実務データでは管路長と波速の比が整数分割で揃わず、
 * 実務目安 Δx = 50〜200 m と Courant 誤差の許容が両立しないことがある。
 *
 * 本関数はまず実務目安の範囲で探し、そこで許容誤差に収まらなければ Δx の下限を
 * 段階的に下げる。どこまで下げたかと理由は `warnings` で返すので、
 * 「なぜ目安より細かい格子が必要なのか」を利用者に説明できる。
 *
 * @example
 * const g = suggestReaches([
 *   { length: 900, waveSpeed: 1135 },
 *   { length: 600, waveSpeed: 1194 },
 *   { length: 400, waveSpeed: 1228 },
 * ]);
 * // g.reaches → [22, 14, 9], g.courantError ≈ 0.0083
 */
export function suggestReaches(
  pipes: ReachCandidatePipe[],
  options: SuggestReachesOptions = {},
): SuggestReachesResult {
  if (pipes.length === 0) throw new Error("管路が 0 本です");
  for (const p of pipes) {
    if (!(p.length > 0) || !(p.waveSpeed > 0)) {
      throw new Error("管路延長と波速は正の値で指定してください。");
    }
  }

  const dxMax = options.dxMax ?? MOC_GRID_SPACING_MAX;
  const dxTarget = options.dxTarget ?? (MOC_GRID_SPACING_RECOMMENDED_MIN + MOC_GRID_SPACING_MAX) / 2;
  const tolerance = options.courantTolerance ?? 0.01;
  const recommendedMin = MOC_GRID_SPACING_RECOMMENDED_MIN;

  // 下限の候補: 実務目安から段階的に下げる（明示指定があればそれだけ）
  const floors = options.dxMin !== undefined
    ? [options.dxMin]
    : [recommendedMin, recommendedMin * 0.7, recommendedMin * 0.4, recommendedMin * 0.2, recommendedMin * 0.1];

  let fallback: { reaches: number[]; dt: number; courantError: number; dxMin: number } | null = null;

  for (const dxMin of floors) {
    if (dxMin > dxMax) continue;
    const found = searchReaches(pipes, dxMin, dxMax, dxTarget, tolerance);
    if (found === null) continue;
    if (fallback === null || found.courantError < fallback.courantError) {
      fallback = { ...found, dxMin };
    }
    if (found.courantError <= tolerance) {
      const warnings: string[] = [];
      if (dxMin < recommendedMin) {
        warnings.push(
          `Δx を実務目安の下限 ${recommendedMin} m 以上にすると Courant 誤差が許容値 `
          + `${(tolerance * 100).toFixed(1)}% に収まらないため、下限を ${dxMin.toFixed(0)} m まで下げました。`
          + `管路長と波速の比が整数分割で揃わないことによるもので、計算精度上の問題はありません`
          + `（技術書 §8.4.2(2)）。`,
        );
      }
      return { reaches: found.reaches, dt: found.dt, courantError: found.courantError, dxMin, warnings };
    }
  }

  if (fallback === null) {
    throw new Error(
      `Δx を ${dxMax} m 以下に収める計算区間数の組が見つかりません。`
      + `管路延長・波速を確認してください。`,
    );
  }
  return {
    reaches: fallback.reaches,
    dt: fallback.dt,
    courantError: fallback.courantError,
    dxMin: fallback.dxMin,
    warnings: [
      `どの分割数でも Courant 誤差が許容値 ${(tolerance * 100).toFixed(1)}% に収まりません`
      + `（最小 ${(fallback.courantError * 100).toFixed(2)}%）。`
      + `管路延長または波速の組み合わせを見直してください（技術書 §8.4.2(2)）。`,
    ],
  };
}

function validateGridSpacing(segs: MocPipeSegment[]): string[] {
  const warnings: string[] = [];
  for (const seg of segs) {
    if (!Number.isInteger(seg.nReaches) || seg.nReaches < 1) {
      throw new Error(`${seg.id}: 計算区間数は1以上の整数で指定してください。`);
    }
    const dx = seg.pipe.length / seg.nReaches;
    if (dx > MOC_GRID_SPACING_MAX) {
      const nMin = Math.ceil(seg.pipe.length / MOC_GRID_SPACING_MAX);
      throw new Error(
        `${seg.id}: 差分距離 Δx=${dx.toFixed(1)} m は設計用水撃圧解析の上限 `
        + `${MOC_GRID_SPACING_MAX} m を超えています。`
        + `計算区間数を ${nMin} 以上にしてください（技術書 §8.4.2(2)）。`,
      );
    }
    if (dx < MOC_GRID_SPACING_RECOMMENDED_MIN) {
      warnings.push(
        `${seg.id}: 差分距離 Δx=${dx.toFixed(1)} m は一般的な実務目安 `
        + `${MOC_GRID_SPACING_RECOMMENDED_MIN}～${MOC_GRID_SPACING_MAX} m より細かい設定です。`
        + `精度上の問題はありませんが、計算負荷を確認してください（技術書 §8.4.2(2)）。`,
      );
    }
  }
  return warnings;
}

/** Hazen-Williams → Darcy-Weisbach 等価摩擦係数（局所流速版） */
function localDarcyF(V: number, D: number, C: number): number {
  const absV = Math.abs(V);
  if (absV < 1e-4) return 0.02;
  const Rh = D / 4;
  // Hazen-Williams 式（技術書 式7.2.2）: V = 0.849·C·R^0.63·I^0.54
  const S = Math.pow(absV / (0.849 * C * Math.pow(Rh, 0.63)), 1 / 0.54);
  // 上限 0.15 は乱流域の妥当範囲として残す。下限は設けない（issue #51）:
  // 粗度係数 C を大きくとった検証条件で無摩擦を表現できるようにするため。
  // 極低流速は上の早期リターンで処理済みで、f は常に乗数としてしか使わないので
  // 0 に近づいても 0 除算は起きない。
  return Math.min((2 * GRAVITY * D * S) / (absV * absV), 0.15);
}

/**
 * 格子点 i の管中心高 [m]（上下流端の直線補間、未指定なら 0）
 *
 * issue #50: 水柱分離は動水頭（水頭 − 管中心高）で判定するため必要。
 */
function pipeElevationAt(seg: MocPipeSegment, i: number): number {
  const up = seg.upstreamElevation ?? 0;
  const dn = seg.downstreamElevation ?? up;
  return up + (dn - up) * (i / seg.nReaches);
}

/** 管路断面積 [m²] */
function pipeArea(D: number): number {
  return (Math.PI * D * D) / 4;
}

/** バルブ開度 τ（0=全閉, 1=全開） */
function valveOpening(t: number, closeTime: number, op: "close" | "open"): number {
  if (op === "close") return closeTime <= 0 ? 0 : Math.max(0, 1 - t / closeTime);
  return closeTime <= 0 ? 1 : Math.min(1, t / closeTime);
}

/** ポンプ速度比 α（GD2 未使用時の線形フォールバック） */
function pumpAlphaFallback(t: number, bc: PumpBC): number {
  const mode = bc.mode ?? "trip";
  if (mode === "start") {
    const st = bc.startupTime ?? 0;
    return st <= 0 ? 1 : Math.min(1, t / st);
  }
  return bc.shutdownTime <= 0 ? 0 : Math.max(0, 1 - t / bc.shutdownTime);
}

// ─── 境界条件ソルバー ──────────────────────────────────────────────────────────

/** 貯水槽 BC */
function solveReservoir(
  charVal: number, B: number, HR: number, isUpstream: boolean,
): { H: number; Q: number } {
  const H = HR;
  const Q = isUpstream ? (H - charVal) / B : (charVal - H) / B;
  return { H, Q };
}

/**
 * バルブ BC（下流端専用）: H_P = CP - B·τᵥ·√H_P の 2 次方程式
 *
 * issue #50: 全閉時・流出不能時は水頭を 0 m で打ち切らず、C+ の値をそのまま返す。
 * 下降側の水撃圧を過小評価（危険側）しないため。負圧の妥当性は runMoc 側で
 * 水蒸気圧水頭と照合して警告する。
 */
function solveValve(
  CP: number, B: number, tau: number, Q0: number, H0v: number,
): { H: number; Q: number } {
  // 全閉 → 行き止まりと同じ（水頭は C+ そのもの、負値も許容）
  if (tau < 1e-10) return { H: CP, Q: 0 };
  // C+ が基準面以下だと弁は流出できない（√H が定義できない）。行き止まり扱い。
  if (CP <= 0) return { H: CP, Q: 0 };
  const H0safe = Math.max(H0v, 0.01);
  const tauV = (tau * Q0) / Math.sqrt(H0safe);
  const disc = B * B * tauV * tauV + 4 * CP;
  const y = (-B * tauV + Math.sqrt(disc)) / 2;
  return { H: y * y, Q: tauV * y };
}

/**
 * ポンプ BC（上流端専用）
 * 技術書式(8.4.10-11) GD²慣性方程式 or 線形フォールバック
 *
 * ── モデルの適用範囲と限界 ────────────────────────────────────────────────────
 * 本実装は H-Q 特性を放物線 H = α²·Hs - Bq·Q² で近似し、トルクは相似則
 *   M_t/M₀ = (Q·H·N₀)/(Q₀·H₀·N) （定効率仮定）
 * から推算する**簡易モデル**である。技術書 §8.4.2(5)c が本来要求するのは
 * Suter 変換による**4象限特性曲線**（正転正流 / 正転逆流 / 逆転逆流 / 逆転正流）
 * を実機データから入力する方式で、以下のケースには本実装は不十分:
 *
 *   • 逆流（Q < 0）を含む過渡: 本実装は checkValve=true で Q≥0 にクランプし、
 *     checkValve=false でも H-Q 放物線が逆流域を表現できない
 *   • 逆転（N < 0）を含む長時間過渡: dN/dt は N>0 域でしか妥当でない
 *   • 効率の動作点依存: 定効率 η₀ で固定
 *   • サージ・キャビテーションを含む詳細解析
 *
 * 適用妥当範囲:
 *   • 正転正流域でのポンプ急停止（trip）の最初の数秒〜数十秒の最大圧力推定
 *   • チェック弁付きシステム
 *   • 起動時のスムーズな立ち上げ（mode=start, prescribed α）
 *
 * 4象限特性が必要な場合は将来的に Suter 曲線データ入力 BC を追加する
 * （MEMORY: project_moc_audit_followups.md 参照）。
 *
 * @param state  可変ポンプ状態 { N: 現在回転速度 [min⁻¹] }
 * @param dt     タイムステップ [s]（GD2 使用時に必要）
 */
function solvePump(
  CM: number, B: number, t: number, bc: PumpBC, A: number,
  state: { N: number }, dt: number,
): { H: number; Q: number } {
  const useGD2 = bc.GD2 !== undefined && bc.N0 !== undefined;
  const mode = bc.mode ?? "trip";

  // ── 速度比 α の取得 ─────────────────────────────────────────────────────
  let alpha: number;
  if (useGD2) {
    alpha = state.N / bc.N0!;
  } else {
    alpha = pumpAlphaFallback(t, bc);
  }
  alpha = Math.max(0, alpha);

  const checkValve = bc.checkValve !== false;
  const Hs = bc.Hs ?? bc.H0 * 1.2;
  const Bq = (Hs - bc.H0) / (bc.Q0 * bc.Q0);

  // ── ポンプ停止時 ─────────────────────────────────────────────────────────
  // issue #50: 停止後は逆止め弁で閉じた行き止まりと同じ。水頭は C- そのもので、
  // 0 m で打ち切らない（ポンプ直後の負圧を過小評価しないため）。
  if (alpha < 1e-6) {
    return { H: CM, Q: 0 };
  }

  // ── H-Q 交点の解 ─────────────────────────────────────────────────────────
  // H = α²·Hs - Bq·Q² かつ H = CM + B·Q → Bq·Q² + B·Q + (CM - α²·Hs) = 0
  const alphaHs = alpha * alpha * Hs;
  const disc = B * B + 4 * Bq * Math.max(alphaHs - CM, 0);

  let H: number, Q: number;
  if (disc < 0 || Bq < 1e-15) {
    Q = (alphaHs - CM) / B;
    H = CM + B * Q;
  } else {
    Q = (-B + Math.sqrt(disc)) / (2 * Bq);
    H = CM + B * Q;
  }

  if (checkValve && Q < 0) {
    // 逆止め弁が閉じる → 行き止まり。水頭は C- そのもの（issue #50）
    H = CM;
    Q = 0;
  }
  Q = Math.max(Q, 0);

  // ── GD² による回転速度更新（技術書式 8.4.10-11）───────────────────────────
  if (useGD2 && state.N > 1e-3) {
    const N_old = state.N;
    const N0 = bc.N0!;
    const GD2 = bc.GD2!;
    const eta0 = bc.eta0 ?? 0.80;

    if (mode === "trip") {
      // 定格トルク M₀ [N·m]
      const M0 = 1000 * GRAVITY * bc.Q0 * bc.H0 * 60 / (2 * Math.PI * N0 * eta0);
      // 現トルク（動力 = ρgQH から推算、簡易定効率仮定）
      const M_t = Q > 1e-6
        ? M0 * (Q * H * N0) / (bc.Q0 * bc.H0 * N_old)
        : M0 * alpha * alpha * 0.1; // 残留抵抗トルク
      // dN/dt = -M_t · 4g·60 / (GD²·2π)  [min⁻¹/s]
      const dNdt = -M_t * 4 * GRAVITY * 60 / (GD2 * 2 * Math.PI);
      state.N = Math.max(0, N_old + dNdt * dt);
    }
    // startup: α は prescribed（線形上昇）→ state.N は外部で更新しない
  }

  return { H, Q };
}

/**
 * 装置節点（エアチャンバ・サージタンク・吸気弁）の求解
 *
 * issue #47: これらの防護工は実務では管路の**途中**に設置する。従来は
 * 「流入管 1 本の末端」としてしか解いておらず、流出管の流量が 0 のまま残って
 * 装置が完全閉そくとして働いていた。
 *
 * ここでは装置を「節点から流量 Q_dev を出し入れする枝」として扱い、
 * 分岐点の連続条件と連立させる。
 *
 *   流入管 k: Q_in,k  = (CP_k − H) / B_k
 *   流出管 k: Q_out,k = (H − CM_k) / B_k
 *   連続条件: Σ Q_in − Σ Q_out − Q_dev(H) = 0
 *
 * S = Σ_in CP_k/B_k + Σ_out CM_k/B_k、T = Σ_all 1/B_k と置くと
 * Σ Q_in − Σ Q_out = S − H·T なので、解くべきは
 *
 *   f(H) = S − H·T − Q_dev(H) = 0
 *
 * 流出管が 0 本（管路末端）の場合はこの一般形の特殊ケースとして落ちるため、
 * 従来の末端配置の挙動はそのまま保たれる。
 */
function solveDeviceNode(
  inPipes: { CP: number; B: number }[],
  outPipes: { CM: number; B: number }[],
  bc: AirChamberBC | SurgeTankBC | AirReleaseValveBC,
  dt: number,
  state: { V_air?: number; z?: number },
): { H: number; Qin: number[]; Qout: number[] } {
  const S = inPipes.reduce((acc, p) => acc + p.CP / p.B, 0)
    + outPipes.reduce((acc, p) => acc + p.CM / p.B, 0);
  const T = inPipes.reduce((acc, p) => acc + 1 / p.B, 0)
    + outPipes.reduce((acc, p) => acc + 1 / p.B, 0);

  const finish = (H: number) => ({
    H,
    Qin: inPipes.map((p) => (p.CP - H) / p.B),
    Qout: outPipes.map((p) => (H - p.CM) / p.B),
  });

  if (T <= 0) return finish(0);

  if (bc.type === "surge_tank") {
    // Q_dev = (H − datum − z)·A_s/Δt は H について線形 → 閉形式で解ける
    //   H = (S + (z + datum)·A_s/Δt) / (T + A_s/Δt)
    const datum = bc.datum ?? 0;
    const k = bc.tankArea / dt;
    const H = (S + (state.z! + datum) * k) / (T + k);
    const Q_dev = (H - datum - state.z!) * k;
    state.z! += Q_dev * dt / bc.tankArea;
    return finish(H);
  }

  if (bc.type === "air_release_valve") {
    // まず装置なし（Q_dev = 0）で解き、大気圧水頭を下回るときだけ開放する
    const H_atm = bc.atmosphericHead ?? 10.33;
    const H_free = S / T;
    return finish(H_free < H_atm ? H_atm : H_free);
  }

  // ── エアチャンバ: ポリトロープ気体則 H·V^m = H_a0·V_a0^m ──────────────────
  //   V_new(H) = V_a0·(H_a0/H)^(1/m)、Q_dev(H) = (V_state − V_new(H)) / Δt
  //   f(H) = S − H·T − Q_dev(H) は H について単調減少なので二分法で確実に解ける。
  const m = bc.polytropicIndex ?? 1.2;
  const V_min = bc.V_air0 * 0.02; // 最小空気容積（チャンバ容量の 2%）
  const V_state = state.V_air!;
  const volumeAt = (H: number) => bc.V_air0 * Math.pow(bc.H_air0 / H, 1 / m);
  const f = (H: number) => S - H * T - (V_state - volumeAt(H)) / dt;

  // 空気容積の下限に対応する水頭の上限（これ以上は圧縮できない）
  const H_ceiling = bc.H_air0 * Math.pow(bc.V_air0 / V_min, m);
  let lo = 1e-9;
  let hi = Math.max(H_ceiling, Math.abs(S / T) * 2 + 1);
  if (f(hi) > 0) {
    // 上限でもまだ f > 0 → 圧縮限界。V_min に張り付く
    state.V_air = V_min;
    return finish(H_ceiling);
  }
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  const H = (lo + hi) / 2;
  state.V_air = Math.min(Math.max(volumeAt(H), V_min), bc.V_air0 / 0.02);
  return finish(H);
}

/**
 * 減圧バルブ BC（設定圧維持）— 管路末端
 * 下流側を H_set に固定、上流から C+ を使って Q を決定
 */
function solvePRV(
  CP: number, B: number, bc: PressureReducingValveBC,
): { H: number; Q: number } {
  const H = bc.setHead;
  const Q = Math.max((CP - H) / B, 0); // 逆流不可
  return { H, Q };
}

/**
 * 減圧バルブ BC — 管路の途中（流入管 1 本・流出管 1 本）
 *
 * issue #47: 減圧弁は流量を出し入れする装置ではなく、節点の上流側と下流側で
 * **異なる水頭**を持つ要素なので、他の防護工とは別扱いにする。
 *
 *   下流側: H_dn = H_set（設定圧を維持）→ Q = (H_set − CM) / B_dn
 *   上流側: H_up = CP − B_up·Q
 *
 * 動作モード:
 *   - 通常制御: 上式のとおり
 *   - 全開: 上流水頭が設定圧まで届かない場合は減圧できないので、
 *           単なる接合点（連続条件のみ）に退化する
 *   - 遮断: 逆流になる場合は Q = 0（逆止機能）
 */
function solvePRVInline(
  inPipe: { CP: number; B: number },
  outPipe: { CM: number; B: number },
  bc: PressureReducingValveBC,
): { H: number; Hout: number; Qin: number; Qout: number } {
  const Q = (bc.setHead - outPipe.CM) / outPipe.B;
  if (Q <= 0) {
    // 逆流 → 遮断。両側とも行き止まりとして解く
    return { H: inPipe.CP, Hout: outPipe.CM, Qin: 0, Qout: 0 };
  }
  const H_up = inPipe.CP - inPipe.B * Q;
  if (H_up <= bc.setHead) {
    // 上流水頭が設定圧以下 → 減圧不要。全開＝単なる接合点
    const H = (inPipe.CP / inPipe.B + outPipe.CM / outPipe.B) / (1 / inPipe.B + 1 / outPipe.B);
    return { H, Hout: H, Qin: (inPipe.CP - H) / inPipe.B, Qout: (H - outPipe.CM) / outPipe.B };
  }
  return { H: H_up, Hout: bc.setHead, Qin: Q, Qout: Q };
}

/**
 * 行き止まり BC: Q=0, H=CP
 *
 * issue #50: 水頭を 0 m で打ち切らない。負圧の妥当性は runMoc 側で
 * 水蒸気圧水頭と照合して警告する。
 */
function solveDeadEnd(CP: number): { H: number; Q: number } {
  return { H: CP, Q: 0 };
}

/**
 * 汎用 n 管路ジャンクションソルバー
 * 技術書 §8.4.2(5)d 分枝点連続条件
 *
 * 流入管路 k: C+ → H = CP_k - B_k·Q_k  ∴ Q_k = (CP_k - H) / B_k
 * 流出管路 k: C- → H = CM_k + B_k·Q_k  ∴ Q_k = (H - CM_k) / B_k
 * 連続: Σ Q_in - Σ Q_out = 0
 * 解: H = (Σ CP_k/B_k + Σ CM_k/B_k) / (Σ 1/B_k)
 */
function solveJunction(
  inPipes: { CP: number; B: number }[],
  outPipes: { CM: number; B: number }[],
): { H: number; Qin: number[]; Qout: number[] } {
  const sumInv = inPipes.reduce((s, p) => s + 1 / p.B, 0)
    + outPipes.reduce((s, p) => s + 1 / p.B, 0);
  const H = (
    inPipes.reduce((s, p) => s + p.CP / p.B, 0)
    + outPipes.reduce((s, p) => s + p.CM / p.B, 0)
  ) / sumInv;
  return {
    H,
    Qin: inPipes.map((p) => (p.CP - H) / p.B),
    Qout: outPipes.map((p) => (H - p.CM) / p.B),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 管路物理量
// ═══════════════════════════════════════════════════════════════════════════════

interface PipePhysics {
  A: number;
  B: number;   // 特性インピーダンス a/(gA)
  dx: number;
  dt: number;
  T0: number;
  hfTotal: number; // 初期条件用の全摩擦損失（定常）
  D: number;       // 内径（局所摩擦計算用）
  C_hw: number;    // H-W 流速係数
}

function computePipePhysics(seg: MocPipeSegment, Q0: number): PipePhysics {
  const { pipe, waveSpeed: a, nReaches: N } = seg;
  const { innerDiameter: D, length: L, roughnessCoeff: C_hw } = pipe;
  const A = pipeArea(D);
  const V0 = Q0 / A;
  const f0 = localDarcyF(V0, D, C_hw);
  const dx = L / N;
  const dt = dx / a;
  const B = a / (GRAVITY * A);
  const hfTotal = (f0 * L * V0 * V0) / (2 * GRAVITY * D);
  const T0 = (4 * L) / a;
  return { A, B, dx, dt, T0, hfTotal, D, C_hw };
}

function steadyHeadProfile(H_upstream: number, hfTotal: number, N: number): number[] {
  return Array.from({ length: N + 1 }, (_, i) => H_upstream - hfTotal * (i / N));
}

function interpolateGrid(values: number[], position: number): number {
  const bounded = Math.min(Math.max(position, 0), values.length - 1);
  const lower = Math.floor(bounded);
  const upper = Math.min(lower + 1, values.length - 1);
  const fraction = bounded - lower;
  return values[lower]! + (values[upper]! - values[lower]!) * fraction;
}

// ═══════════════════════════════════════════════════════════════════════════════
// メイン MOC ソルバー
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 汎用特性曲線法（MOC）ソルバー
 * 直列・分岐管路、全境界条件タイプに対応
 */
export function runMoc(network: MocNetwork, options: MocOptions = {}): MocResult {
  const { pipes: rawSegs, nodes } = network;
  if (rawSegs.length === 0) throw new Error("管路が 0 本です");

  // 整合化処理へ渡す前に、計算区間数が格子として成立することを保証する。
  validateGridSpacing(rawSegs);

  // ── dt 整合化（技術書 §8.4.2(2)）─────────────────────────────────────────
  const { segs, warnings: harmonizeWarnings } = harmonizeTimeStep(rawSegs);
  const warnings: string[] = [...harmonizeWarnings];
  // 管路網では整合化により分割数が変わるため、実際に使用する差分距離を再検証する。
  warnings.push(...validateGridSpacing(segs));

  // ── ノード接続グラフ構築 ──────────────────────────────────────────────────
  // nodeFlowIn[nodeId]  = 管路インデックスの配列（この node が下流端である管路）
  // nodeFlowOut[nodeId] = 管路インデックスの配列（この node が上流端である管路）
  const nodeFlowIn: Record<string, number[]> = {};
  const nodeFlowOut: Record<string, number[]> = {};
  for (let pi = 0; pi < segs.length; pi++) {
    const { upstreamNodeId: up, downstreamNodeId: dn } = segs[pi]!;
    (nodeFlowIn[dn] ??= []).push(pi);
    (nodeFlowOut[up] ??= []).push(pi);
  }
  const allNodeIds = [...new Set(segs.flatMap((s) => [s.upstreamNodeId, s.downstreamNodeId]))];

  // ── 各管路の初期流量推算 ──────────────────────────────────────────────────
  function inferQ0(pi: number): number {
    if (options.initialFlow !== undefined) return options.initialFlow;
    const seg = segs[pi]!;
    if (seg.initialFlow !== undefined) return seg.initialFlow;
    // 上流 BC から
    const upBC = nodes[seg.upstreamNodeId];
    if (upBC?.type === "pump") return upBC.Q0;
    // 下流 BC から
    const dnBC = nodes[seg.downstreamNodeId];
    if (dnBC?.type === "valve") return dnBC.Q0;
    if (dnBC?.type === "pressure_reducing_valve") return dnBC.Q0;
    return 0;
  }
  const Q0arr = segs.map((_, pi) => inferQ0(pi));

  // ── 各管路の物理量 ────────────────────────────────────────────────────────
  const physics: PipePhysics[] = segs.map((seg, pi) => computePipePhysics(seg, Q0arr[pi]!));

  // 全管路の dt の最小値（統一タイムステップ）
  const dt_global = Math.min(...physics.map((p) => p.dt));

  // ── クーラン条件 Δt ≤ Δx/(V+a) の検証（技術書 式8.4.8）─────────────────────
  // 実装は CFL=1 (Δt ≒ Δx/a) を採用するため、厳密には V/a の分だけ安全側を超える。
  // 通常 V/a ≦ 0.001 で実害なしだが、V/a > 0.01（管内流速が波速の1%超）の高流速管路では
  // 数値伝播速度が物理的伝播速度を上回る可能性を警告する。
  for (let pi = 0; pi < segs.length; pi++) {
    const ph = physics[pi]!;
    const V0 = Math.abs(Q0arr[pi]!) / ph.A;
    const ratio = V0 / segs[pi]!.waveSpeed;
    if (ratio > 0.01) {
      warnings.push(
        `${segs[pi]!.id}: V/a=${ratio.toFixed(4)} > 0.01。技術書式(8.4.8) Δt≤Δx/(V+a) に対し`
        + `本ソルバの Δt=Δx/a は ${(ratio * 100).toFixed(2)}% 超過しています。`
        + `nReaches を増やすか、初期流速を見直してください。`,
      );
    }
  }
  const vaporHead = options.vaporPressureHead ?? MOC_VAPOR_PRESSURE_HEAD;
  /** 最初に水蒸気圧水頭を下回った位置・時刻（issue #50） */
  let cavitation: { pipeId: string; index: number; t: number; H: number; gauge: number } | null = null;

  const T0_max = Math.max(...physics.map((p) => p.T0));
  const tMax = options.tMax ?? 3 * T0_max;
  const nSteps = Math.ceil(tMax / dt_global);

  // ── 初期水頭プロファイル（BFS で各管路上流端 H を伝播）────────────────────
  const nodeH0: Record<string, number> = { ...(options.initialNodeHeads ?? {}) };
  // シード: 既知水頭の境界ノード
  for (const [nodeId, bc] of Object.entries(nodes)) {
    if (bc.type === "reservoir") nodeH0[nodeId] = bc.head;
    else if (bc.type === "valve") nodeH0[nodeId] = bc.H0v;
    else if (bc.type === "pump") {
      nodeH0[nodeId] = (bc.mode ?? "trip") === "start"
        ? (bc.staticHead ?? 0)
        : bc.H0;
    }
    else if (bc.type === "surge_tank") nodeH0[nodeId] = bc.initialLevel + (bc.datum ?? 0);
    else if (bc.type === "air_chamber") nodeH0[nodeId] = bc.H_air0;
    else if (bc.type === "pressure_reducing_valve") nodeH0[nodeId] = bc.setHead;
  }
  // BFS 伝播（上流 → 下流）
  const bfsVisited = new Set(Object.keys(nodeH0));
  const bfsQueue = [...bfsVisited];
  while (bfsQueue.length > 0) {
    const nodeId = bfsQueue.shift()!;
    const H_here = nodeH0[nodeId]!;
    for (let pi = 0; pi < segs.length; pi++) {
      const seg = segs[pi]!;
      if (seg.upstreamNodeId === nodeId && !bfsVisited.has(seg.downstreamNodeId)) {
        nodeH0[seg.downstreamNodeId] = H_here - physics[pi]!.hfTotal;
        bfsVisited.add(seg.downstreamNodeId);
        bfsQueue.push(seg.downstreamNodeId);
      }
    }
  }
  // 未解決ノード（分岐の末端など）は 0
  for (const id of allNodeIds) {
    if (nodeH0[id] === undefined) nodeH0[id] = 0;
  }

  // ── 状態配列の初期化 ──────────────────────────────────────────────────────
  const Hs: number[][] = segs.map((seg, pi) => {
    const H_up = nodeH0[seg.upstreamNodeId] ?? 0;
    const H_down = nodeH0[seg.downstreamNodeId];
    return H_down === undefined
      ? steadyHeadProfile(H_up, physics[pi]!.hfTotal, seg.nReaches)
      : Array.from(
        { length: seg.nReaches + 1 },
        (_, i) => H_up + (H_down - H_up) * (i / seg.nReaches),
      );
  });
  const Qs: number[][] = segs.map((seg, pi) => new Array<number>(seg.nReaches + 1).fill(Q0arr[pi]!));

  const Hmaxes: number[][] = Hs.map((h) => [...h]);
  const Hmines: number[][] = Hs.map((h) => [...h]);
  const H_steadyArr: number[][] = Hs.map((h) => [...h]);

  const saveEvery = Math.max(1, Math.floor(nSteps / 200));
  const snapshotsArr: MocSnapshot[][] = segs.map(() => []);

  // ── 節点時系列 ────────────────────────────────────────────────────────────
  const nodeSeriesH: Record<string, { t: number; H: number }[]> = {};
  const nodeSeriesN: Record<string, { t: number; N: number }[]> = {};
  const nodeSeriesV: Record<string, { t: number; V: number }[]> = {};
  const nodeSeriesZ: Record<string, { t: number; z: number }[]> = {};
  for (const id of allNodeIds) {
    nodeSeriesH[id] = [];
  }

  // ── 状態変数（ポンプ速度・エアチャンバ・サージタンク） ──────────────────
  const pumpState: Record<string, { N: number }> = {};
  const airChamberState: Record<string, { V_air: number }> = {};
  const surgeTankState: Record<string, { z: number }> = {};

  for (const [nodeId, bc] of Object.entries(nodes)) {
    if (bc.type === "pump") {
      const useGD2 = bc.GD2 !== undefined && bc.N0 !== undefined;
      const N_init = useGD2
        ? ((bc.mode ?? "trip") === "start" ? 0 : bc.N0!)
        : bc.N0 ?? 1450;
      pumpState[nodeId] = { N: N_init };
      nodeSeriesN[nodeId] = [];
    }
    if (bc.type === "air_chamber") {
      airChamberState[nodeId] = { V_air: bc.V_air0 };
      nodeSeriesV[nodeId] = [];
    }
    if (bc.type === "surge_tank") {
      surgeTankState[nodeId] = { z: bc.initialLevel };
      nodeSeriesZ[nodeId] = [];
    }
  }

  // ── t=0 記録 ─────────────────────────────────────────────────────────────
  for (let pi = 0; pi < segs.length; pi++) {
    const seg = segs[pi]!;
    const N = seg.nReaches;
    nodeSeriesH[seg.upstreamNodeId]!.push({ t: 0, H: Hs[pi]![0]! });
    nodeSeriesH[seg.downstreamNodeId]!.push({ t: 0, H: Hs[pi]![N]! });
    snapshotsArr[pi]!.push({ t: 0, H: [...Hs[pi]!], Q: [...Qs[pi]!] });
  }
  for (const [id, st] of Object.entries(pumpState)) {
    nodeSeriesN[id]!.push({ t: 0, N: st.N });
  }
  for (const [id, st] of Object.entries(airChamberState)) {
    nodeSeriesV[id]!.push({ t: 0, V: st.V_air });
  }
  for (const [id, st] of Object.entries(surgeTankState)) {
    nodeSeriesZ[id]!.push({ t: 0, z: st.z });
  }

  // ── 時間積分 ──────────────────────────────────────────────────────────────
  const Hnews: number[][] = segs.map((seg) => new Array<number>(seg.nReaches + 1));
  const Qnews: number[][] = segs.map((seg) => new Array<number>(seg.nReaches + 1));

  for (let step = 1; step <= nSteps; step++) {
    const t = step * dt_global;

    // ── 1. 各管路の内部節点 (i=1..N-1) ─────────────────────────────────────
    for (let pi = 0; pi < segs.length; pi++) {
      const N = segs[pi]!.nReaches;
      const H = Hs[pi]!;
      const Q = Qs[pi]!;
      const { B, D, C_hw, dx, A } = physics[pi]!;
      const courant = segs[pi]!.waveSpeed * dt_global / dx;
      const travelDx = segs[pi]!.waveSpeed * dt_global;
      const Hnew = Hnews[pi]!;
      const Qnew = Qnews[pi]!;

      for (let i = 1; i <= N - 1; i++) {
        const Qa = interpolateGrid(Q, i - courant);
        const Qb = interpolateGrid(Q, i + courant);
        const Ha = interpolateGrid(H, i - courant);
        const Hb = interpolateGrid(H, i + courant);
        // 局所可変摩擦係数（H-W → D-W、現流速で再計算）
        const Ra = localDarcyF(Qa / A, D, C_hw) * travelDx / (2 * GRAVITY * D * A * A);
        const Rb = localDarcyF(Qb / A, D, C_hw) * travelDx / (2 * GRAVITY * D * A * A);
        const CP = Ha + B * Qa - Ra * Qa * Math.abs(Qa);
        const CM = Hb - B * Qb + Rb * Qb * Math.abs(Qb);
        Hnew[i] = (CP + CM) / 2;
        Qnew[i] = (CP - CM) / (2 * B);
      }
    }

    // ── 2. 管路端の C+/C- を計算 ────────────────────────────────────────────
    // CP[pi]: 管路 pi 下流端の C+ 値
    // CM[pi]: 管路 pi 上流端の C- 値
    const CP_arr: number[] = new Array<number>(segs.length);
    const CM_arr: number[] = new Array<number>(segs.length);

    for (let pi = 0; pi < segs.length; pi++) {
      const N = segs[pi]!.nReaches;
      const H = Hs[pi]!;
      const Q = Qs[pi]!;
      const { B, D, C_hw, dx, A } = physics[pi]!;
      const courant = segs[pi]!.waveSpeed * dt_global / dx;
      const travelDx = segs[pi]!.waveSpeed * dt_global;

      const Q_N1 = interpolateGrid(Q, N - courant);
      const H_N1 = interpolateGrid(H, N - courant);
      const R_dn = localDarcyF(Q_N1 / A, D, C_hw) * travelDx / (2 * GRAVITY * D * A * A);
      CP_arr[pi] = H_N1 + B * Q_N1 - R_dn * Q_N1 * Math.abs(Q_N1);

      const Q_1 = interpolateGrid(Q, courant);
      const H_1 = interpolateGrid(H, courant);
      const R_up = localDarcyF(Q_1 / A, D, C_hw) * travelDx / (2 * GRAVITY * D * A * A);
      CM_arr[pi] = H_1 - B * Q_1 + R_up * Q_1 * Math.abs(Q_1);
    }

    // ── 3. 全ノードを一括処理 ───────────────────────────────────────────────
    const nodeHnew: Record<string, number> = {};
    /** 上流側と下流側で水頭が異なる節点（減圧弁）の下流側水頭 */
    const nodeHnewOut: Record<string, number> = {};
    // nodeQin[nodeId][k]  = nodeFlowIn[nodeId][k] の管路端での Q
    // nodeQout[nodeId][k] = nodeFlowOut[nodeId][k] の管路端での Q
    const nodeQin: Record<string, number[]> = {};
    const nodeQout: Record<string, number[]> = {};

    for (const nodeId of allNodeIds) {
      const bc = nodes[nodeId];
      const inPipes = nodeFlowIn[nodeId] ?? [];   // この node に流入する管路
      const outPipes = nodeFlowOut[nodeId] ?? [];  // この node から流出する管路

      let H_node: number;
      /** 減圧弁のように上流側と下流側で水頭が異なる節点用（未設定なら H_node と同じ） */
      let H_node_out: number | undefined;
      let Q_ins: number[] = new Array(inPipes.length).fill(0);
      let Q_outs: number[] = new Array(outPipes.length).fill(0);

      if (!bc) {
        // ── 内部ジャンクション（分枝点・直列接続）─────────────────────────
        const inData  = inPipes.map((pi) => ({ CP: CP_arr[pi]!, B: physics[pi]!.B }));
        const outData = outPipes.map((pi) => ({ CM: CM_arr[pi]!, B: physics[pi]!.B }));
        const { H, Qin, Qout } = solveJunction(inData, outData);
        H_node = H;
        Q_ins = Qin;
        Q_outs = Qout;

      } else if (bc.type === "reservoir") {
        H_node = bc.head;
        Q_ins  = inPipes.map((pi) => (CP_arr[pi]! - H_node) / physics[pi]!.B);
        Q_outs = outPipes.map((pi) => (H_node - CM_arr[pi]!) / physics[pi]!.B);

      } else if (bc.type === "valve") {
        // バルブは単一流入管の末端
        const pi = inPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const tau = valveOpening(t, bc.closeTime, bc.operation ?? "close");
          const r = solveValve(CP_arr[pi]!, physics[pi]!.B, tau, bc.Q0, bc.H0v);
          H_node = r.H;
          Q_ins = [r.Q];
        }

      } else if (bc.type === "pump") {
        // ポンプは単一流出管の上流端
        const pi = outPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const st = pumpState[nodeId] ?? { N: bc.N0 ?? 0 };
          const r = solvePump(CM_arr[pi]!, physics[pi]!.B, t, bc, physics[pi]!.A, st, dt_global);
          H_node = r.H;
          Q_outs = [r.Q];
        }

      } else if (
        bc.type === "air_chamber" || bc.type === "surge_tank" || bc.type === "air_release_valve"
      ) {
        // ── 防護工（issue #47）────────────────────────────────────────────
        // 装置を「節点から流量 Q_dev を出し入れする枝」として扱い、
        // 分岐点の連続条件と連立させる。管路末端・管路途中のどちらでも解ける。
        const inData  = inPipes.map((pi) => ({ CP: CP_arr[pi]!, B: physics[pi]!.B }));
        const outData = outPipes.map((pi) => ({ CM: CM_arr[pi]!, B: physics[pi]!.B }));
        const st: { V_air?: number; z?: number } = bc.type === "air_chamber"
          ? airChamberState[nodeId]!
          : bc.type === "surge_tank"
            ? surgeTankState[nodeId]!
            : {};
        const r = solveDeviceNode(inData, outData, bc, dt_global, st);
        H_node = r.H;
        Q_ins = r.Qin;
        Q_outs = r.Qout;

      } else if (bc.type === "pressure_reducing_valve") {
        // ── 減圧バルブ（issue #47）─────────────────────────────────────────
        // 上流側と下流側で水頭が異なるため、装置枝ではなく専用の扱いにする。
        if (inPipes.length === 1 && outPipes.length === 1) {
          const pin = inPipes[0]!, pout = outPipes[0]!;
          const r = solvePRVInline(
            { CP: CP_arr[pin]!, B: physics[pin]!.B },
            { CM: CM_arr[pout]!, B: physics[pout]!.B },
            bc,
          );
          H_node = r.H;
          H_node_out = r.Hout;
          Q_ins = [r.Qin];
          Q_outs = [r.Qout];
        } else if (outPipes.length === 0 && inPipes.length >= 1) {
          // 管路末端の減圧弁（従来どおり）
          const pi = inPipes[0]!;
          const r = solvePRV(CP_arr[pi]!, physics[pi]!.B, bc);
          H_node = r.H;
          Q_ins = [r.Q];
        } else {
          // 未対応構成（流入・流出が複数）。接合点として解き、警告は初期化時に出す
          const inData  = inPipes.map((pi) => ({ CP: CP_arr[pi]!, B: physics[pi]!.B }));
          const outData = outPipes.map((pi) => ({ CM: CM_arr[pi]!, B: physics[pi]!.B }));
          const r = solveJunction(inData, outData);
          H_node = r.H;
          Q_ins = r.Qin;
          Q_outs = r.Qout;
        }

      } else {
        // dead_end
        const pi = inPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const r = solveDeadEnd(CP_arr[pi]!);
          H_node = r.H;
          Q_ins = [0];
        }
      }

      nodeHnew[nodeId] = H_node;
      if (H_node_out !== undefined) nodeHnewOut[nodeId] = H_node_out;
      nodeQin[nodeId] = Q_ins;
      nodeQout[nodeId] = Q_outs;
      nodeSeriesH[nodeId]!.push({ t, H: H_node });
    }

    // ── 4. 管路端点への反映 ──────────────────────────────────────────────────
    for (const nodeId of allNodeIds) {
      const H_node = nodeHnew[nodeId]!;
      const inPipes = nodeFlowIn[nodeId] ?? [];
      const outPipes = nodeFlowOut[nodeId] ?? [];
      const Q_ins  = nodeQin[nodeId]  ?? [];
      const Q_outs = nodeQout[nodeId] ?? [];

      for (let k = 0; k < inPipes.length; k++) {
        const pi = inPipes[k]!;
        Hnews[pi]![segs[pi]!.nReaches] = H_node;
        Qnews[pi]![segs[pi]!.nReaches] = Q_ins[k] ?? 0;
      }
      const H_out = nodeHnewOut[nodeId] ?? H_node;
      for (let k = 0; k < outPipes.length; k++) {
        const pi = outPipes[k]!;
        Hnews[pi]![0] = H_out;
        Qnews[pi]![0] = Q_outs[k] ?? 0;
      }
    }

    // ── 5. 状態時系列記録 ────────────────────────────────────────────────────
    if (step % saveEvery === 0) {
      for (const [id, st] of Object.entries(pumpState)) {
        nodeSeriesN[id]!.push({ t, N: st.N });
      }
      for (const [id, st] of Object.entries(airChamberState)) {
        nodeSeriesV[id]!.push({ t, V: st.V_air });
      }
      for (const [id, st] of Object.entries(surgeTankState)) {
        nodeSeriesZ[id]!.push({ t, z: st.z });
      }
    }

    // ── 6. バッファ更新・包絡線更新 ─────────────────────────────────────────
    for (let pi = 0; pi < segs.length; pi++) {
      const N = segs[pi]!.nReaches;
      for (let i = 0; i <= N; i++) {
        const h = Hnews[pi]![i]!;
        const q = Qnews[pi]![i]!;
        Hs[pi]![i] = h;
        Qs[pi]![i] = q;
        if (h > Hmaxes[pi]![i]!) Hmaxes[pi]![i] = h;
        if (h < Hmines[pi]![i]!) Hmines[pi]![i] = h;
        // 水柱分離の判定（issue #50）: 動水頭が最初に水蒸気圧水頭を下回った位置・時刻
        if (cavitation === null) {
          const gauge = h - pipeElevationAt(segs[pi]!, i);
          if (gauge < vaporHead) {
            cavitation = { pipeId: segs[pi]!.id, index: i, t, H: h, gauge };
          }
        }
      }
      if (step % saveEvery === 0) {
        snapshotsArr[pi]!.push({ t, H: [...Hs[pi]!], Q: [...Qs[pi]!] });
      }
    }
  }

  // ── 水柱分離の警告（issue #50）─────────────────────────────────────────────
  if (cavitation !== null) {
    const pi = segs.findIndex((s2) => s2.id === cavitation!.pipeId);
    const dist = pi >= 0 ? cavitation.index * physics[pi]!.dx : 0;
    const seg = pi >= 0 ? segs[pi]! : undefined;
    const hasElevation = seg !== undefined
      && (seg.upstreamElevation !== undefined || seg.downstreamElevation !== undefined);
    warnings.push(
      `${cavitation.pipeId}: 上流端から ${dist.toFixed(0)} m の地点（格子点 ${cavitation.index}）で `
      + `t=${cavitation.t.toFixed(2)} s に動水頭が ${cavitation.gauge.toFixed(2)} m`
      + `（動水位 ${cavitation.H.toFixed(2)} m）となり、`
      + `水蒸気圧水頭 ${vaporHead.toFixed(2)} m を下回りました。この位置で水柱分離（キャビテーション）が`
      + `発生する可能性がありますが、本ソルバーは分離・再結合の挙動を追跡しません。`
      + `これ以降の計算結果は参考値として扱い、技術書 §8.3 の防護工検討に進んでください。`
      + (hasElevation ? "" : "（管中心高が未指定のため基準面 0 m で判定しています。"
        + "標高差のある管路では upstreamElevation / downstreamElevation を指定してください。）"),
    );
  }

  // ── 結果整形 ──────────────────────────────────────────────────────────────
  const pipesResult: Record<string, MocPipeResult> = {};
  for (let pi = 0; pi < segs.length; pi++) {
    const seg = segs[pi]!;
    const ph = physics[pi]!;
    pipesResult[seg.id] = {
      waveSpeed: seg.waveSpeed,
      dx: ph.dx,
      nReaches: seg.nReaches,
      vibrationPeriod: ph.T0,
      H_steady: H_steadyArr[pi]!,
      Hmax: Hmaxes[pi]!,
      Hmin: Hmines[pi]!,
      snapshots: snapshotsArr[pi]!,
    };
  }

  const nodesResult: Record<string, MocNodeResult> = {};
  for (const id of allNodeIds) {
    const result: MocNodeResult = { H: nodeSeriesH[id]! };
    if (nodeSeriesN[id]?.length) result.N = nodeSeriesN[id];
    if (nodeSeriesV[id]?.length) result.V_air = nodeSeriesV[id];
    if (nodeSeriesZ[id]?.length) result.z = nodeSeriesZ[id];
    nodesResult[id] = result;
  }

  return {
    dt: dt_global,
    tMax,
    pipes: pipesResult,
    nodes: nodesResult,
    ...(warnings.length > 0 && { warnings }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 便利 API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 便利APIが組み立てる単一管路ネットワークの識別子を決める。
 *
 * 以前は "pipe_0" / "upstream" / "downstream"（ポンプは "pump_node" / "dead_end_node"）
 * という内部の仮IDで固定していた。仮IDは計算結果の `pipes` / `nodes` のキーとしてそのまま
 * 外へ出るため、呼び出し側は結果を実際の管路・節点へ対応付けられない。web-free では
 * 単一管路の過渡解析・ポンプ過渡解析だけ縦断図の結果重ね合わせと平面図の着色が効かず、
 * 系列名も内部識別子のまま画面に出ていた（docs/ui-terminology.md: 内部の識別子を画面に
 * 出さない）。入力の管路が持つIDを優先する。
 *
 * プロトコル入力では startNodeId / endNodeId を省略できる（protocol.py の `_pipe` は
 * 空文字を既定にする）。空、または上下流が同じIDのときだけ従来の仮IDへ落とす — 節点IDが
 * 重複すると単一節点のネットワークになり、計算そのものが壊れるため。
 */
function conveniencePipeIds(pipe: Pipe, upstreamFallback: string, downstreamFallback: string): {
  pipeId: string;
  upstreamNodeId: string;
  downstreamNodeId: string;
} {
  const upstream = pipe.startNodeId?.trim() || upstreamFallback;
  const downstream = pipe.endNodeId?.trim() || downstreamFallback;
  const distinct = upstream !== downstream;
  return {
    pipeId: pipe.id?.trim() || "pipe_0",
    upstreamNodeId: distinct ? upstream : upstreamFallback,
    downstreamNodeId: distinct ? downstream : downstreamFallback,
  };
}

/** 単一管路シナリオの簡易入力型 */
export interface SinglePipeMocInput {
  pipe: Pipe;
  waveSpeed: number;
  initialVelocity: number;
  initialDownstreamHead: number;
  closeTime: number;
  nReaches?: number;
  tMax?: number;
  operation?: "close" | "open";
}

/** 単一管路（貯水槽 → バルブ）便利関数 */
export function runMocSinglePipe(input: SinglePipeMocInput): MocResult {
  const {
    pipe, waveSpeed, initialVelocity, initialDownstreamHead: H0v,
    closeTime, nReaches = 10, tMax, operation = "close",
  } = input;

  const A = pipeArea(pipe.innerDiameter);
  const Q0 = initialVelocity * A;
  const f = localDarcyF(initialVelocity, pipe.innerDiameter, pipe.roughnessCoeff);
  const hfTotal = (f * pipe.length * initialVelocity * initialVelocity) / (2 * GRAVITY * pipe.innerDiameter);
  const HR = H0v + hfTotal;

  const { pipeId, upstreamNodeId, downstreamNodeId } = conveniencePipeIds(pipe, "upstream", "downstream");
  const network: MocNetwork = {
    pipes: [{ id: pipeId, pipe, waveSpeed, nReaches, upstreamNodeId, downstreamNodeId }],
    nodes: {
      [upstreamNodeId]: { type: "reservoir", head: HR },
      [downstreamNodeId]: { type: "valve", Q0, H0v, closeTime, operation },
    },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: Q0 });
}

// ── ポンプ急停止 ──────────────────────────────────────────────────────────────

export interface PumpTripInput {
  pipe: Pipe;
  waveSpeed: number;
  Q0: number;
  pumpHead: number;
  Hs?: number;
  /** GD² [N·m²]（指定時は技術書式8.4.10-11 GD²慣性方程式を使用） */
  GD2?: number;
  /** 定格回転速度 [min⁻¹]（GD2 使用時に必要） */
  N0?: number;
  /** 定格効率 η₀（デフォルト 0.80） */
  eta0?: number;
  /** 停止完了時間 [s]（GD2 未指定時の線形フォールバック） */
  shutdownTime?: number;
  checkValve?: boolean;
  nReaches?: number;
  tMax?: number;
}

export function runMocPumpTrip(input: PumpTripInput): MocResult {
  const {
    pipe, waveSpeed, Q0, pumpHead, Hs, GD2, N0, eta0,
    shutdownTime = 0, checkValve = true, nReaches = 10, tMax,
  } = input;

  const pumpBC: PumpBC = {
    type: "pump", Q0, H0: pumpHead,
    ...(Hs !== undefined && { Hs }),
    ...(GD2 !== undefined && { GD2 }),
    ...(N0 !== undefined && { N0 }),
    ...(eta0 !== undefined && { eta0 }),
    shutdownTime, checkValve, mode: "trip",
  };

  const { pipeId, upstreamNodeId, downstreamNodeId } = conveniencePipeIds(pipe, "pump_node", "dead_end_node");
  const network: MocNetwork = {
    pipes: [{ id: pipeId, pipe, waveSpeed, nReaches, upstreamNodeId, downstreamNodeId }],
    nodes: { [upstreamNodeId]: pumpBC, [downstreamNodeId]: { type: "dead_end" } },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: Q0 });
}

// ── ポンプ起動 ────────────────────────────────────────────────────────────────

export interface PumpStartInput {
  pipe: Pipe;
  waveSpeed: number;
  Q_rated: number;
  pumpHead: number;
  Hs?: number;
  startupTime: number;
  staticHead?: number;
  nReaches?: number;
  tMax?: number;
}

export function runMocPumpStart(input: PumpStartInput): MocResult {
  const { pipe, waveSpeed, Q_rated, pumpHead, Hs, startupTime, staticHead = 0, nReaches = 10, tMax } = input;

  const { pipeId, upstreamNodeId, downstreamNodeId } = conveniencePipeIds(pipe, "pump_node", "dead_end_node");
  const network: MocNetwork = {
    pipes: [{ id: pipeId, pipe, waveSpeed, nReaches, upstreamNodeId, downstreamNodeId }],
    nodes: {
      [upstreamNodeId]: {
        type: "pump", Q0: Q_rated, H0: pumpHead,
        ...(Hs !== undefined && { Hs }),
        shutdownTime: 0, mode: "start", startupTime, staticHead,
      },
      [downstreamNodeId]: { type: "dead_end" },
    },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: 0 });
}
