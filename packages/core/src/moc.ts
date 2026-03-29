/**
 * 特性曲線法（Method of Characteristics）による水撃圧非定常計算
 *
 * 適用条件:
 *   - 単一管路
 *   - 上流端: 一定水頭貯水槽（定水頭境界）
 *   - 下流端: バルブ操作（線形閉そく / 線形開放）
 *   - 摩擦: 準定常 Darcy-Weisbach（Hazen-Williams係数から初期流速条件で換算）
 *   - 弾性管モデル（波速一定）
 *
 * 出典: 土地改良設計基準パイプライン技術書 §8.4、
 *       Wylie & Streeter "Fluid Transients" (1993)
 */

import type { Pipe } from "./types.js";
import { GRAVITY } from "./formulas.js";

// ─── 型定義 ────────────────────────────────────────────────────────────────

export interface MocInput {
  pipe: Pipe;
  /** 波速 a [m/s]（calcWaveSpeed の結果を渡す） */
  waveSpeed: number;
  /** 初期流速 V₀ [m/s] */
  initialVelocity: number;
  /** バルブ（下流端）の初期水頭 H₀ [m] */
  initialDownstreamHead: number;
  /** 閉そく時間 tν [s]（0 = 瞬時閉） */
  closeTime: number;
  /** 管路分割数 N（デフォルト 10、クーラン条件: Δt = Δx/a） */
  nReaches?: number;
  /** シミュレーション時間 [s]（デフォルト: 圧力振動周期 T₀ の 3 倍） */
  tMax?: number;
  /** 操作方向: "close"（デフォルト）= バルブ閉, "open" = バルブ開 */
  operation?: "close" | "open";
}

/** 1タイムステップのスナップショット */
export interface MocSnapshot {
  /** 時刻 [s] */
  t: number;
  /** 各節点の水頭 H [m]（node 0 = 上流端, node N = 下流端） */
  H: number[];
  /** 各節点の流量 Q [m³/s] */
  Q: number[];
}

export interface MocResult {
  /** タイムステップ幅 Δt [s] */
  dt: number;
  /** 空間ステップ幅 Δx [m] */
  dx: number;
  /** 分割数 N */
  nReaches: number;
  /** 全スナップショット */
  snapshots: MocSnapshot[];
  /** 各節点の最大水頭 [m] */
  Hmax: number[];
  /** 各節点の最小水頭 [m] */
  Hmin: number[];
  /** 下流端（バルブ）の時系列水頭 */
  downstreamH: { t: number; H: number }[];
  /** 上流端の時系列水頭 */
  upstreamH: { t: number; H: number }[];
  /** 計算条件サマリー */
  summary: {
    waveSpeed: number;
    vibrationPeriod: number;
    upstreamHead: number;
    initialDownstreamHead: number;
    Hmax_downstream: number;
    Hmin_downstream: number;
    deltaHmax: number;
  };
}

// ─── 摩擦係数換算 ──────────────────────────────────────────────────────────

/**
 * Hazen-Williams係数 → Darcy-Weisbach摩擦係数 f（初期流速条件で換算）
 *
 * H-W: V = 0.8492 × C × R_h^0.63 × S^0.54  (SI単位系)
 * → S = (V / (0.8492 × C × (D/4)^0.63))^(1/0.54)
 * → f = 2gDS / V²
 */
function hwToDarcyWeisbach(V0: number, D: number, C: number): number {
  if (V0 < 1e-4) return 0.02; // 零流速時はデフォルト値
  const Rh = D / 4;
  const S = Math.pow(V0 / (0.8492 * C * Math.pow(Rh, 0.63)), 1 / 0.54);
  const f = (2 * GRAVITY * D * S) / (V0 * V0);
  // 物理的に妥当な範囲にクリップ (0.005 〜 0.15)
  return Math.max(0.005, Math.min(f, 0.15));
}

// ─── バルブ開度関数 ────────────────────────────────────────────────────────

/**
 * バルブ開度 τ (0=全閉, 1=全開)
 * 線形操作: close なら 1→0、open なら 0→1
 */
function valveOpening(t: number, closeTime: number, operation: "close" | "open"): number {
  if (operation === "close") {
    if (closeTime <= 0) return 0; // 瞬時閉
    return Math.max(0, 1 - t / closeTime);
  } else {
    if (closeTime <= 0) return 1; // 瞬時開
    return Math.min(1, t / closeTime);
  }
}

// ─── メイン ───────────────────────────────────────────────────────────────

/**
 * 特性曲線法による非定常水撃圧計算
 *
 * @param input  計算条件
 * @returns      計算結果（スナップショット列・包絡線・サマリー）
 */
export function runMoc(input: MocInput): MocResult {
  const {
    pipe,
    waveSpeed: a,
    initialVelocity: V0,
    initialDownstreamHead: H0v,
    closeTime: tv,
    nReaches: N = 10,
    operation = "close",
  } = input;

  const { innerDiameter: D, wallThickness: _t, length: L, roughnessCoeff: C } = pipe;
  const A = (Math.PI * D * D) / 4; // 断面積 [m²]
  const Q0 = V0 * A;                // 初期流量 [m³/s]

  // ── 時空間刻み（クーラン条件: CFL = 1） ────────────────────────────────
  const dx = L / N;
  const dt = dx / a; // Δt = Δx/a

  // ── 圧力振動周期 ────────────────────────────────────────────────────────
  const T0 = (4 * L) / a;
  const tMax = input.tMax ?? 3 * T0;
  const nSteps = Math.ceil(tMax / dt);

  // ── 摩擦係数・特性インピーダンス ──────────────────────────────────────
  const f = hwToDarcyWeisbach(V0, D, C);
  const B = a / (GRAVITY * A);                    // 特性インピーダンス [s/m²]
  const R = (f * dx) / (2 * GRAVITY * D * A * A); // 摩擦係数項 [s²/m⁵]

  // ── 定常状態の初期水頭分布 ─────────────────────────────────────────────
  // Darcy-Weisbach 総摩擦損失: hf = f·L·V²/(2gD)
  const hfTotal = (f * L * V0 * V0) / (2 * GRAVITY * D);
  const HR = H0v + hfTotal; // 上流端（貯水槽）水頭 [m]

  // 初期水頭: 上流から下流へ線形に変化
  const H = Array.from({ length: N + 1 }, (_, i) => HR - hfTotal * (i / N));
  const Q = new Array<number>(N + 1).fill(Q0);

  // ── 包絡線初期化 ────────────────────────────────────────────────────────
  const Hmax = [...H];
  const Hmin = [...H];

  // ── 結果蓄積 ─────────────────────────────────────────────────────────────
  const snapshots: MocSnapshot[] = [];
  const downstreamH: { t: number; H: number }[] = [];
  const upstreamH: { t: number; H: number }[] = [];

  // スナップショット保存間隔（メモリ節約: 最大 200 スナップショット）
  const saveEvery = Math.max(1, Math.floor(nSteps / 200));

  // t=0 を保存
  snapshots.push({ t: 0, H: [...H], Q: [...Q] });
  downstreamH.push({ t: 0, H: H[N]! });
  upstreamH.push({ t: 0, H: H[0]! });

  // ── 時間積分 ─────────────────────────────────────────────────────────────
  const Hnew = new Array<number>(N + 1);
  const Qnew = new Array<number>(N + 1);

  for (let step = 1; step <= nSteps; step++) {
    const t = step * dt;

    // C+特性値: CP[i] = H[i-1] + B·Q[i-1] - R·Q[i-1]·|Q[i-1]|
    // C-特性値: CM[i] = H[i+1] - B·Q[i+1] + R·Q[i+1]·|Q[i+1]|

    // ── 内部節点 (i = 1 ... N-1) ──────────────────────────────────────────
    for (let i = 1; i <= N - 1; i++) {
      const Qa = Q[i - 1]!;
      const Qb = Q[i + 1]!;
      const CP = H[i - 1]! + B * Qa - R * Qa * Math.abs(Qa);
      const CM = H[i + 1]! - B * Qb + R * Qb * Math.abs(Qb);
      Hnew[i] = (CP + CM) / 2;
      Qnew[i] = (CP - CM) / (2 * B);
    }

    // ── 上流端境界条件（定水頭貯水槽: H = HR = 一定） ─────────────────────
    {
      const Qb = Q[1]!;
      const CM = H[1]! - B * Qb + R * Qb * Math.abs(Qb);
      Hnew[0] = HR;
      Qnew[0] = (HR - CM) / B;
    }

    // ── 下流端境界条件（バルブ: 水頭依存型流量） ──────────────────────────
    {
      const tau = valveOpening(t, tv, operation);
      const Qa = Q[N - 1]!;
      const CP = H[N - 1]! + B * Qa - R * Qa * Math.abs(Qa);

      if (tau < 1e-10) {
        // 全閉: 流量ゼロ
        Hnew[N] = CP;
        Qnew[N] = 0;
      } else {
        // 水頭依存流量: QP = τ·(Q0/√H0v)·√HP
        // C+から: HP = CP - B·QP
        // 代入: HP = CP - B·τ_v·√HP  (τ_v = τ·Q0/√H0v)
        // √HP について2次方程式を解く
        const H0vSafe = Math.max(H0v, 0.01); // ゼロ除算防止
        const tauV = tau * Q0 / Math.sqrt(H0vSafe);
        const disc = B * B * tauV * tauV + 4 * Math.max(CP, 0);
        const y = (-B * tauV + Math.sqrt(disc)) / 2; // √HP ≥ 0
        Hnew[N] = y * y;
        Qnew[N] = tauV * y;
      }

      // 負圧クリップ（気液分離の簡易近似）
      if (Hnew[N]! < 0) Hnew[N] = 0;
    }

    // ── バッファ更新 ────────────────────────────────────────────────────────
    for (let i = 0; i <= N; i++) {
      H[i] = Hnew[i]!;
      Q[i] = Qnew[i]!;
      if (H[i]! > Hmax[i]!) Hmax[i] = H[i]!;
      if (H[i]! < Hmin[i]!) Hmin[i] = H[i]!;
    }

    // ── 結果保存 ────────────────────────────────────────────────────────────
    downstreamH.push({ t, H: H[N]! });
    upstreamH.push({ t, H: H[0]! });

    if (step % saveEvery === 0) {
      snapshots.push({ t, H: [...H], Q: [...Q] });
    }
  }

  const Hmax_ds = Math.max(...downstreamH.map((p) => p.H));
  const Hmin_ds = Math.min(...downstreamH.map((p) => p.H));

  return {
    dt,
    dx,
    nReaches: N,
    snapshots,
    Hmax: Hmax as number[],
    Hmin: Hmin as number[],
    downstreamH,
    upstreamH,
    summary: {
      waveSpeed: a,
      vibrationPeriod: T0,
      upstreamHead: HR,
      initialDownstreamHead: H0v,
      Hmax_downstream: Hmax_ds,
      Hmin_downstream: Hmin_ds,
      deltaHmax: Hmax_ds - H0v,
    },
  };
}
