/**
 * 特性曲線法（Method of Characteristics）汎用水撃圧非定常計算エンジン
 *
 * 対応シナリオ:
 *   - バルブ急閉・緩閉・急開・緩開
 *   - ポンプ急停止（逆止め弁なし / あり）
 *   - 複数管路直列
 *   - 任意の組み合わせ（上流 BC × 下流 BC × 管路数）
 *
 * 弾性管モデル・準定常 Darcy-Weisbach 摩擦・CFL=1 クーラン条件
 *
 * 出典: 土地改良設計基準パイプライン技術書 §8.4
 *       Wylie & Streeter "Fluid Transients in Systems" (1993)
 */

import type { Pipe } from "./types.js";
import { GRAVITY } from "./formulas.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 境界条件型（Discriminated Union）
// ═══════════════════════════════════════════════════════════════════════════════

/** 定水頭貯水槽（上流 / 下流どちらにも配置可） */
export interface ReservoirBC {
  type: "reservoir";
  /** 水頭 H_R [m] */
  head: number;
}

/**
 * バルブ
 * 線形開度変化: close → 1→0, open → 0→1
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
 * 放物線型 H-Q 特性: H_pump = Hs - Bq·Q²
 * 急停止 (mode="trip"): α(t) = max(0, 1 - t/shutdownTime)
 * 起動   (mode="start"): α(t) = min(1, t/startupTime)
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
  /** 停止完了時間 t_decel [s]（mode="trip" 時に使用） */
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

/** 行き止まり（Q=0 の剛体端、下流端専用） */
export interface DeadEndBC {
  type: "dead_end";
}

export type BoundaryCondition = ReservoirBC | ValveBC | PumpBC | DeadEndBC;

// ═══════════════════════════════════════════════════════════════════════════════
// 管網型
// ═══════════════════════════════════════════════════════════════════════════════

/** 管路区間 */
export interface MocPipeSegment {
  /** 管路 ID（結果の key に使用） */
  id: string;
  pipe: Pipe;
  /** 波速 a [m/s]（calcWaveSpeed の結果を渡す） */
  waveSpeed: number;
  /** 分割数 N（Δt = Δx/a） */
  nReaches: number;
  /** 上流節点 ID */
  upstreamNodeId: string;
  /** 下流節点 ID */
  downstreamNodeId: string;
}

/**
 * 管網定義
 * 現在は直列管路のみ対応（pipes は上流→下流の順に並べること）
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
  /** 全管路共通の初期流量 Q₀ [m³/s]（省略時は上流 BC から推算） */
  initialFlow?: number;
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
  /** 定常初期水頭プロファイル */
  H_steady: number[];
  Hmax: number[];
  Hmin: number[];
  /** 間引きスナップショット（最大 200 点） */
  snapshots: MocSnapshot[];
}

export interface MocNodeResult {
  /** 節点水頭時系列 */
  H: { t: number; H: number }[];
}

export interface MocResult {
  dt: number;
  tMax: number;
  pipes: Record<string, MocPipeResult>;
  nodes: Record<string, MocNodeResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 内部ヘルパー
// ═══════════════════════════════════════════════════════════════════════════════

/** Hazen-Williams 係数 → Darcy-Weisbach 摩擦係数（初期流速条件） */
function hwToDarcyWeisbach(V0: number, D: number, C: number): number {
  if (V0 < 1e-4) return 0.02;
  const Rh = D / 4;
  const S = Math.pow(V0 / (0.8492 * C * Math.pow(Rh, 0.63)), 1 / 0.54);
  return Math.max(0.005, Math.min((2 * GRAVITY * D * S) / (V0 * V0), 0.15));
}

/** バルブ開度 τ（0=全閉, 1=全開） */
function valveOpening(t: number, closeTime: number, op: "close" | "open"): number {
  if (op === "close") return closeTime <= 0 ? 0 : Math.max(0, 1 - t / closeTime);
  return closeTime <= 0 ? 1 : Math.min(1, t / closeTime);
}

/** ポンプ回転速度比 α（0=停止, 1=定格） */
function pumpSpeedRatio(t: number, bc: PumpBC): number {
  const mode = bc.mode ?? "trip";
  if (mode === "start") {
    const st = bc.startupTime ?? 0;
    return st <= 0 ? 1 : Math.min(1, t / st);
  }
  return bc.shutdownTime <= 0 ? 0 : Math.max(0, 1 - t / bc.shutdownTime);
}

/** 管路断面積 [m²] */
function pipeArea(D: number): number {
  return (Math.PI * D * D) / 4;
}

// ─── 境界条件ソルバー ──────────────────────────────────────────────────────────

/**
 * 貯水槽 BC（上流端 or 下流端）
 * 上流端: C- から Q を求める
 * 下流端: C+ から Q を求める
 */
function solveReservoir(
  charVal: number, // CM (上流端) or CP (下流端)
  B: number,
  HR: number,
  isUpstream: boolean,
): { H: number; Q: number } {
  const H = HR;
  const Q = isUpstream ? (H - charVal) / B : (charVal - H) / B;
  return { H, Q };
}

/**
 * バルブ BC（下流端専用）
 * H_P = CP - B·τᵥ·√H_P を 2 次方程式で求解
 */
function solveValve(
  CP: number,
  B: number,
  tau: number,
  Q0: number,
  H0v: number,
): { H: number; Q: number } {
  if (tau < 1e-10) {
    const H = Math.max(CP, 0);
    return { H, Q: 0 };
  }
  const H0safe = Math.max(H0v, 0.01);
  const tauV = (tau * Q0) / Math.sqrt(H0safe);
  const disc = B * B * tauV * tauV + 4 * Math.max(CP, 0);
  const y = (-B * tauV + Math.sqrt(disc)) / 2;
  return { H: Math.max(y * y, 0), Q: tauV * y };
}

/**
 * ポンプ BC（上流端専用）
 * H_pump(Q, α) = α²·Hs - Bq·Q²
 * C-: H_P = CM + B·Q_P
 * → Bq·Q² + B·Q + (CM - α²·Hs) = 0
 */
function solvePump(
  CM: number,
  B: number,
  t: number,
  bc: PumpBC,
  A: number,
): { H: number; Q: number } {
  const alpha = pumpSpeedRatio(t, bc);
  const Hs = bc.Hs ?? bc.H0 * 1.2;
  const Bq = (Hs - bc.H0) / (bc.Q0 * bc.Q0); // 放物線係数
  const checkValve = bc.checkValve !== false;

  if (alpha < 1e-6) {
    // ポンプ完全停止: 逆止め弁閉（行き止まり）or 逆流
    if (checkValve) {
      return { H: CM, Q: 0 };
    }
    // 逆止め弁なし: Q は負になり得る（ここでは簡略化: Q=0）
    return { H: CM, Q: 0 };
  }

  const alphaHs = alpha * alpha * Hs;
  const discriminant = B * B + 4 * Bq * (alphaHs - CM);

  if (discriminant < 0 || Bq < 1e-15) {
    // Bq≈0（フラット特性）or 判別式負: 線形近似
    const Q = (alphaHs - CM) / B;
    const H = CM + B * Q;
    if (checkValve && Q < 0) return { H: CM, Q: 0 };
    return { H: Math.max(H, 0), Q: Math.max(Q, 0) };
  }

  const Q = (-B + Math.sqrt(discriminant)) / (2 * Bq);
  const H = CM + B * Q;

  if (checkValve && Q < 0) return { H: CM, Q: 0 };
  return { H: Math.max(H, 0), Q: Math.max(Q, 0) };
}

/** 行き止まり BC（下流端専用）: Q=0, H=CP */
function solveDeadEnd(CP: number): { H: number; Q: number } {
  return { H: Math.max(CP, 0), Q: 0 };
}

/**
 * 直列接続節点（ジャンクション）
 * 上流管路 上端 → C+ (CP_up, B_up)
 * 下流管路 下端 → C- (CM_dn, B_dn)
 * 継続条件: Q_up = Q_dn、水頭等値
 */
function solveSeriesJunction(
  CP_up: number,
  B_up: number,
  CM_dn: number,
  B_dn: number,
): { H: number; Q: number } {
  const Q = (CP_up - CM_dn) / (B_up + B_dn);
  const H = CP_up - B_up * Q;
  return { H, Q };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 初期条件計算
// ═══════════════════════════════════════════════════════════════════════════════

interface PipePhysics {
  A: number;   // 断面積
  f: number;   // Darcy-Weisbach f
  B: number;   // 特性インピーダンス
  R: number;   // 摩擦項係数
  dx: number;
  dt: number;
  T0: number;
  hfTotal: number; // 全摩擦損失
}

function computePipePhysics(seg: MocPipeSegment, Q0: number): PipePhysics {
  const { pipe, waveSpeed: a, nReaches: N } = seg;
  const { innerDiameter: D, wallThickness: _t, length: L, roughnessCoeff: C } = pipe;
  const A = pipeArea(D);
  const V0 = Q0 / A;
  const f = hwToDarcyWeisbach(V0, D, C);
  const dx = L / N;
  const dt = dx / a;
  const B = a / (GRAVITY * A);
  const R = (f * dx) / (2 * GRAVITY * D * A * A);
  const hfTotal = (f * L * V0 * V0) / (2 * GRAVITY * D);
  const T0 = (4 * L) / a;
  return { A, f, B, R, dx, dt, T0, hfTotal };
}

/**
 * 定常状態の水頭プロファイルを生成
 * H[i] = H_upstream - hfTotal * (i/N)
 */
function steadyHeadProfile(H_upstream: number, hfTotal: number, N: number): number[] {
  return Array.from({ length: N + 1 }, (_, i) => H_upstream - hfTotal * (i / N));
}

// ═══════════════════════════════════════════════════════════════════════════════
// メイン
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 汎用特性曲線法（MOC）ソルバー
 *
 * @param network  管網定義（管路区間 + 境界条件）
 * @param options  計算オプション
 */
export function runMoc(network: MocNetwork, options: MocOptions = {}): MocResult {
  const { pipes: segs, nodes } = network;

  if (segs.length === 0) throw new Error("管路が 0 本です");

  // ── 初期流量推算 ────────────────────────────────────────────────────────────
  // 上流 BC（reservoir / pump）から初期流量を取得、または options.initialFlow を使用
  let Q0 = options.initialFlow ?? 0;
  if (Q0 === 0) {
    const upstreamBC = nodes[segs[0]!.upstreamNodeId];
    if (upstreamBC?.type === "pump") Q0 = upstreamBC.Q0;
    // reservoir の場合は下流 BC から推算
    if (!Q0) {
      const downstreamBC = nodes[segs[segs.length - 1]!.downstreamNodeId];
      if (downstreamBC?.type === "valve") Q0 = downstreamBC.Q0;
      if (downstreamBC?.type === "dead_end") Q0 = 0;
    }
  }

  // ── 各管路の物理量と初期水頭 ────────────────────────────────────────────────
  const physics: PipePhysics[] = segs.map((seg) => computePipePhysics(seg, Q0));

  // 全区間で統一した dt（最小 dt = 最短 Δx/a = 最大厳格なクーラン条件）
  // ※ 直列のとき各管路の dt が一致するよう nReaches を調整することが理想だが
  //   現段階では各管路ごとに独立した dt で時間積分する
  const dt_global = Math.min(...physics.map((p) => p.dt));

  // T0 の最大値からシミュレーション時間を決定
  const T0_max = Math.max(...physics.map((p) => p.T0));
  const tMax = options.tMax ?? 3 * T0_max;
  const nSteps = Math.ceil(tMax / dt_global);

  // ── 定常状態ヘッドの構築 ────────────────────────────────────────────────────
  // 上流端 → 下流端に向けて head を伝播
  const H_upstream_arr: number[] = [];
  {
    // 最上流の境界水頭
    const upBC = nodes[segs[0]!.upstreamNodeId];
    let H_up: number;
    if (upBC?.type === "reservoir") {
      H_up = upBC.head;
    } else if (upBC?.type === "pump") {
      if ((upBC.mode ?? "trip") === "start") {
        // 起動前: ポンプ停止中の静水頭（配管内静圧）
        H_up = upBC.staticHead ?? 0;
      } else {
        H_up = upBC.H0 + physics[0]!.hfTotal; // pump 揚程 ≈ 下流水頭 + 損失
      }
    } else {
      // 下流 valve からバックトレース
      const downBC = nodes[segs[segs.length - 1]!.downstreamNodeId];
      const H_valve = downBC?.type === "valve" ? downBC.H0v : 0;
      H_up = H_valve + physics.reduce((sum, p) => sum + p.hfTotal, 0);
    }
    H_upstream_arr.push(H_up);
    for (let pi = 1; pi < segs.length; pi++) {
      H_upstream_arr.push(H_upstream_arr[pi - 1]! - physics[pi - 1]!.hfTotal);
    }
  }

  // ── 状態配列の初期化 ────────────────────────────────────────────────────────
  const Hs: number[][] = segs.map((seg, pi) =>
    steadyHeadProfile(H_upstream_arr[pi]!, physics[pi]!.hfTotal, seg.nReaches),
  );
  const Qs: number[][] = segs.map((seg) => new Array<number>(seg.nReaches + 1).fill(Q0));

  // ── 包絡線・スナップショット初期化 ──────────────────────────────────────────
  const Hmaxes: number[][] = Hs.map((h) => [...h]);
  const Hmines: number[][] = Hs.map((h) => [...h]);
  const H_steadyArr: number[][] = Hs.map((h) => [...h]);

  const saveEvery = Math.max(1, Math.floor(nSteps / 200));
  const snapshotsArr: MocSnapshot[][] = segs.map(() => []);

  // ── 節点水頭時系列 ──────────────────────────────────────────────────────────
  const nodeSeriesH: Record<string, { t: number; H: number }[]> = {};
  for (const nodeId of Object.keys(nodes)) nodeSeriesH[nodeId] = [];
  // 内部接続節点も記録
  for (const seg of segs) {
    if (!nodeSeriesH[seg.upstreamNodeId]) nodeSeriesH[seg.upstreamNodeId] = [];
    if (!nodeSeriesH[seg.downstreamNodeId]) nodeSeriesH[seg.downstreamNodeId] = [];
  }

  // t=0 記録
  for (let pi = 0; pi < segs.length; pi++) {
    const seg = segs[pi]!;
    const N = seg.nReaches;
    nodeSeriesH[seg.upstreamNodeId]!.push({ t: 0, H: Hs[pi]![0]! });
    nodeSeriesH[seg.downstreamNodeId]!.push({ t: 0, H: Hs[pi]![N]! });
    snapshotsArr[pi]!.push({ t: 0, H: [...Hs[pi]!], Q: [...Qs[pi]!] });
  }

  // ── 時間積分 ────────────────────────────────────────────────────────────────
  const Hnews: number[][] = segs.map((seg) => new Array<number>(seg.nReaches + 1));
  const Qnews: number[][] = segs.map((seg) => new Array<number>(seg.nReaches + 1));

  for (let step = 1; step <= nSteps; step++) {
    const t = step * dt_global;

    // ── 各管路の内部節点 (i=1..N-1) ────────────────────────────────────────
    for (let pi = 0; pi < segs.length; pi++) {
      const N = segs[pi]!.nReaches;
      const H = Hs[pi]!;
      const Q = Qs[pi]!;
      const { B, R } = physics[pi]!;
      const Hnew = Hnews[pi]!;
      const Qnew = Qnews[pi]!;

      for (let i = 1; i <= N - 1; i++) {
        const Qa = Q[i - 1]!;
        const Qb = Q[i + 1]!;
        const CP = H[i - 1]! + B * Qa - R * Qa * Math.abs(Qa);
        const CM = H[i + 1]! - B * Qb + R * Qb * Math.abs(Qb);
        Hnew[i] = (CP + CM) / 2;
        Qnew[i] = (CP - CM) / (2 * B);
      }
    }

    // ── 境界・接続節点の処理 ────────────────────────────────────────────────

    // 各管路の上流端 C- 特性値、下流端 C+ 特性値を計算
    const CP_downstream: number[] = [];
    const CM_upstream: number[] = [];

    for (let pi = 0; pi < segs.length; pi++) {
      const N = segs[pi]!.nReaches;
      const H = Hs[pi]!;
      const Q = Qs[pi]!;
      const { B, R } = physics[pi]!;

      // 下流端 C+ （node N-1 → N）
      const Qa_dn = Q[N - 1]!;
      CP_downstream[pi] = H[N - 1]! + B * Qa_dn - R * Qa_dn * Math.abs(Qa_dn);

      // 上流端 C- （node 1 → 0）
      const Qb_up = Q[1]!;
      CM_upstream[pi] = H[1]! - B * Qb_up + R * Qb_up * Math.abs(Qb_up);
    }

    // 直列管路の内部接続節点（junction）を解く
    // 管路 pi の下流端 = 管路 pi+1 の上流端
    const junctionH: number[] = [];
    const junctionQ: number[] = [];
    for (let pi = 0; pi < segs.length - 1; pi++) {
      const dnNodeId = segs[pi]!.downstreamNodeId;
      const upNodeId = segs[pi + 1]!.upstreamNodeId;
      if (dnNodeId === upNodeId) {
        // 直列接続ジャンクション
        const { H: Hj, Q: Qj } = solveSeriesJunction(
          CP_downstream[pi]!,
          physics[pi]!.B,
          CM_upstream[pi + 1]!,
          physics[pi + 1]!.B,
        );
        junctionH[pi] = Hj;
        junctionQ[pi] = Qj;
        nodeSeriesH[dnNodeId]!.push({ t, H: Hj });
      }
    }

    // 最上流端境界条件（管路 0 の上流端）
    {
      const pi = 0;
      const N = segs[pi]!.nReaches;
      const nodeId = segs[pi]!.upstreamNodeId;
      const bc = nodes[nodeId];
      const { B } = physics[pi]!;
      const CM = CM_upstream[pi]!;
      let H_new: number, Q_new: number;

      if (bc?.type === "reservoir") {
        ({ H: H_new, Q: Q_new } = solveReservoir(CM, B, bc.head, true));
      } else if (bc?.type === "pump") {
        const A = physics[pi]!.A;
        ({ H: H_new, Q: Q_new } = solvePump(CM, B, t, bc, A));
      } else {
        // BC 未定義: 貯水槽として扱う（初期水頭を維持）
        H_new = H_upstream_arr[pi]!;
        Q_new = (H_new - CM) / B;
      }
      Hnews[pi]![0] = H_new;
      Qnews[pi]![0] = Q_new;
      nodeSeriesH[nodeId]!.push({ t, H: H_new });
    }

    // 最下流端境界条件（最後の管路の下流端）
    {
      const pi = segs.length - 1;
      const N = segs[pi]!.nReaches;
      const nodeId = segs[pi]!.downstreamNodeId;
      const bc = nodes[nodeId];
      const { B } = physics[pi]!;
      const CP = CP_downstream[pi]!;
      let H_new: number, Q_new: number;

      if (bc?.type === "valve") {
        const tau = valveOpening(t, bc.closeTime, bc.operation ?? "close");
        ({ H: H_new, Q: Q_new } = solveValve(CP, B, tau, bc.Q0, bc.H0v));
      } else if (bc?.type === "reservoir") {
        ({ H: H_new, Q: Q_new } = solveReservoir(CP, B, bc.head, false));
      } else if (bc?.type === "dead_end") {
        ({ H: H_new, Q: Q_new } = solveDeadEnd(CP));
      } else {
        H_new = Math.max(CP, 0);
        Q_new = 0;
      }
      Hnews[pi]![N] = H_new;
      Qnews[pi]![N] = Q_new;
      nodeSeriesH[nodeId]!.push({ t, H: H_new });
    }

    // 直列接続ジャンクションを各管路の端点に反映
    for (let pi = 0; pi < segs.length - 1; pi++) {
      if (junctionH[pi] !== undefined) {
        const N_up = segs[pi]!.nReaches;
        Hnews[pi]![N_up] = junctionH[pi]!;
        Qnews[pi]![N_up] = junctionQ[pi]!;
        Hnews[pi + 1]![0] = junctionH[pi]!;
        Qnews[pi + 1]![0] = junctionQ[pi]!;
      }
    }

    // ── バッファ更新・包絡線更新 ─────────────────────────────────────────────
    for (let pi = 0; pi < segs.length; pi++) {
      const N = segs[pi]!.nReaches;
      for (let i = 0; i <= N; i++) {
        const h = Hnews[pi]![i]!;
        const q = Qnews[pi]![i]!;
        Hs[pi]![i] = h;
        Qs[pi]![i] = q;
        if (h > Hmaxes[pi]![i]!) Hmaxes[pi]![i] = h;
        if (h < Hmines[pi]![i]!) Hmines[pi]![i] = h;
      }
      if (step % saveEvery === 0) {
        snapshotsArr[pi]!.push({ t, H: [...Hs[pi]!], Q: [...Qs[pi]!] });
      }
    }
  }

  // ── 結果整形 ─────────────────────────────────────────────────────────────────
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
  for (const [id, series] of Object.entries(nodeSeriesH)) {
    nodesResult[id] = { H: series };
  }

  return { dt: dt_global, tMax, pipes: pipesResult, nodes: nodesResult };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 単一管路便利 API（旧 MocInput との互換ラッパー）
// ═══════════════════════════════════════════════════════════════════════════════

/** 単一管路シナリオの簡易入力型（旧 API） */
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

/**
 * 単一管路（貯水槽→バルブ）の便利関数
 * 旧 runMoc(MocInput) と同等の使用感を提供
 */
export function runMocSinglePipe(input: SinglePipeMocInput): MocResult {
  const {
    pipe,
    waveSpeed,
    initialVelocity,
    initialDownstreamHead: H0v,
    closeTime,
    nReaches = 10,
    tMax,
    operation = "close",
  } = input;

  const A = pipeArea(pipe.innerDiameter);
  const Q0 = initialVelocity * A;
  const f = hwToDarcyWeisbach(initialVelocity, pipe.innerDiameter, pipe.roughnessCoeff);
  const hfTotal = (f * pipe.length * initialVelocity * initialVelocity) / (2 * GRAVITY * pipe.innerDiameter);
  const HR = H0v + hfTotal;

  const network: MocNetwork = {
    pipes: [{
      id: "pipe_0",
      pipe,
      waveSpeed,
      nReaches,
      upstreamNodeId: "upstream",
      downstreamNodeId: "downstream",
    }],
    nodes: {
      upstream: { type: "reservoir", head: HR },
      downstream: { type: "valve", Q0, H0v, closeTime, operation },
    },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: Q0 });
}

/**
 * ポンプ急停止シナリオの便利関数
 * pump（上流端）→ 単一管路 → dead_end（下流端）
 */
export interface PumpTripInput {
  pipe: Pipe;
  waveSpeed: number;
  /** 定格流量 Q₀ [m³/s] */
  Q0: number;
  /** ポンプ揚程（=定格時の上流端水頭）H₀ [m] */
  pumpHead: number;
  /** 締切水頭 Hs [m]（デフォルト 1.2×H₀） */
  Hs?: number;
  /** 停止完了時間 [s] */
  shutdownTime: number;
  /** 逆止め弁の有無（デフォルト true） */
  checkValve?: boolean;
  nReaches?: number;
  tMax?: number;
}

/** ポンプ起動シナリオの便利関数 */
export interface PumpStartInput {
  pipe: Pipe;
  waveSpeed: number;
  /** 定格流量 Q₀ [m³/s] */
  Q_rated: number;
  /** 定格揚程 H₀ [m] */
  pumpHead: number;
  /** 締切水頭 Hs [m]（デフォルト 1.2×H₀） */
  Hs?: number;
  /** 起動完了時間 [s] */
  startupTime: number;
  /** 起動前の静水頭（管内静圧）[m]（デフォルト 0） */
  staticHead?: number;
  nReaches?: number;
  tMax?: number;
}

export function runMocPumpStart(input: PumpStartInput): MocResult {
  const {
    pipe, waveSpeed, Q_rated, pumpHead, Hs, startupTime,
    staticHead = 0, nReaches = 10, tMax,
  } = input;

  const network: MocNetwork = {
    pipes: [{
      id: "pipe_0",
      pipe,
      waveSpeed,
      nReaches,
      upstreamNodeId: "pump_node",
      downstreamNodeId: "dead_end_node",
    }],
    nodes: {
      pump_node: {
        type: "pump",
        Q0: Q_rated,
        H0: pumpHead,
        ...(Hs !== undefined && { Hs }),
        shutdownTime: 0,
        mode: "start",
        startupTime,
        staticHead,
      },
      dead_end_node: { type: "dead_end" },
    },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: 0 });
}

export function runMocPumpTrip(input: PumpTripInput): MocResult {
  const {
    pipe,
    waveSpeed,
    Q0,
    pumpHead,
    Hs,
    shutdownTime,
    checkValve = true,
    nReaches = 10,
    tMax,
  } = input;

  const network: MocNetwork = {
    pipes: [{
      id: "pipe_0",
      pipe,
      waveSpeed,
      nReaches,
      upstreamNodeId: "pump_node",
      downstreamNodeId: "dead_end_node",
    }],
    nodes: {
      pump_node: { type: "pump", Q0, H0: pumpHead, ...(Hs !== undefined && { Hs }), shutdownTime, checkValve },
      dead_end_node: { type: "dead_end" },
    },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: Q0 });
}
