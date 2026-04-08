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
        + `Δx の理想値からの誤差 ${(relErr * 100).toFixed(1)}%（CFL≠1）。`
        + `nReaches を増やすか管路長/波速の比を見直してください。`,
      );
    } else if (N_new !== s.nReaches) {
      warnings.push(`${s.id}: dt整合化で nReaches=${s.nReaches}→${N_new}（誤差 ${(relErr * 100).toFixed(2)}%）`);
    }
    return { ...s, nReaches: N_new };
  });

  return { segs: harmonized, dt, warnings };
}

/** Hazen-Williams → Darcy-Weisbach 等価摩擦係数（局所流速版） */
function localDarcyF(V: number, D: number, C: number): number {
  const absV = Math.abs(V);
  if (absV < 1e-4) return 0.02;
  const Rh = D / 4;
  // Hazen-Williams 式（技術書 式7.2.2）: V = 0.849·C·R^0.63·I^0.54
  const S = Math.pow(absV / (0.849 * C * Math.pow(Rh, 0.63)), 1 / 0.54);
  return Math.max(0.005, Math.min((2 * GRAVITY * D * S) / (absV * absV), 0.15));
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

/** バルブ BC（下流端専用）: H_P = CP - B·τᵥ·√H_P の 2 次方程式 */
function solveValve(
  CP: number, B: number, tau: number, Q0: number, H0v: number,
): { H: number; Q: number } {
  if (tau < 1e-10) return { H: Math.max(CP, 0), Q: 0 };
  const H0safe = Math.max(H0v, 0.01);
  const tauV = (tau * Q0) / Math.sqrt(H0safe);
  const disc = B * B * tauV * tauV + 4 * Math.max(CP, 0);
  const y = (-B * tauV + Math.sqrt(disc)) / 2;
  return { H: Math.max(y * y, 0), Q: tauV * y };
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
  if (alpha < 1e-6) {
    if (checkValve) return { H: Math.max(CM, 0), Q: 0 };
    return { H: Math.max(CM, 0), Q: 0 };
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
    H = Math.max(CM, 0);
    Q = 0;
  }
  H = Math.max(H, 0);
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
 * エアチャンバ BC
 * H_a · V_a^m = const（ポリトロープ気体則）
 * 陽的 predictor-corrector で安定更新
 */
function solveAirChamber(
  CP: number, B: number, dt: number, bc: AirChamberBC,
  state: { V_air: number },
): { H: number; Q: number } {
  const m = bc.polytropicIndex ?? 1.2;
  const V_min = bc.V_air0 * 0.02; // 最小空気容積（チャンバ容量の 2%）

  // 現在の気体圧水頭
  const H_cur = bc.H_air0 * Math.pow(bc.V_air0 / state.V_air, m);

  // Predictor: 現水頭から Q を推算
  const Q_pred = (CP - H_cur) / B;
  const V_pred = Math.max(state.V_air - Q_pred * dt, V_min);
  const H_pred = bc.H_air0 * Math.pow(bc.V_air0 / V_pred, m);

  // Corrector: 修正水頭から Q を再計算
  const Q_corr = (CP - H_pred) / B;
  const Q_avg = (Q_pred + Q_corr) / 2;

  // 最終更新
  state.V_air = Math.max(state.V_air - Q_avg * dt, V_min);
  const H_new = bc.H_air0 * Math.pow(bc.V_air0 / state.V_air, m);

  return { H: H_new, Q: Q_avg };
}

/**
 * サージタンク BC（技術書 §8.5 主対象）
 * A_s·dz/dt = Q_in を陰的離散化で無条件安定に解く
 *
 * 陰的解:
 *   H_new = (z_old + datum + CP·γ) / (1 + γ)  ここで γ = dt / (B·A_s)
 */
function solveSurgeTank(
  CP: number, B: number, dt: number, bc: SurgeTankBC,
  state: { z: number },
): { H: number; Q: number } {
  const datum = bc.datum ?? 0;
  const gamma = dt / (B * bc.tankArea);
  const H_new = (state.z + datum + CP * gamma) / (1 + gamma);
  const Q_new = (CP - H_new) / B;
  state.z += Q_new * dt / bc.tankArea;
  return { H: H_new, Q: Q_new };
}

/**
 * 吸気弁 BC（負圧防止）
 * H < H_atm のとき開放: H = H_atm
 * H ≥ H_atm のとき全閉: Q = 0（行き止まり）
 */
function solveAirReleaseValve(
  CP: number, B: number, bc: AirReleaseValveBC,
): { H: number; Q: number } {
  const H_atm = bc.atmosphericHead ?? 10.33;
  // 行き止まりとして試算
  const H_dead = Math.max(CP, 0);
  if (H_dead < H_atm) {
    // 負圧 → 吸気弁開放、大気圧維持
    const Q = (CP - H_atm) / B; // 大気に向かう流れ（通常正）
    return { H: H_atm, Q };
  }
  // 弁閉（行き止まり）
  return { H: H_dead, Q: 0 };
}

/**
 * 減圧バルブ BC（設定圧維持）
 * 下流側を H_set に固定、上流から C+ を使ってQ を決定
 */
function solvePRV(
  CP: number, B: number, bc: PressureReducingValveBC,
): { H: number; Q: number } {
  const H = bc.setHead;
  const Q = Math.max((CP - H) / B, 0); // 逆流不可
  return { H, Q };
}

/** 行き止まり BC: Q=0, H=CP */
function solveDeadEnd(CP: number): { H: number; Q: number } {
  return { H: Math.max(CP, 0), Q: 0 };
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

  // ── dt 整合化（技術書 §8.4.2(2)）─────────────────────────────────────────
  const { segs, warnings: harmonizeWarnings } = harmonizeTimeStep(rawSegs);
  const warnings: string[] = [...harmonizeWarnings];

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
  const T0_max = Math.max(...physics.map((p) => p.T0));
  const tMax = options.tMax ?? 3 * T0_max;
  const nSteps = Math.ceil(tMax / dt_global);

  // ── 初期水頭プロファイル（BFS で各管路上流端 H を伝播）────────────────────
  const nodeH0: Record<string, number> = {};
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
    return steadyHeadProfile(H_up, physics[pi]!.hfTotal, seg.nReaches);
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
      const Hnew = Hnews[pi]!;
      const Qnew = Qnews[pi]!;

      for (let i = 1; i <= N - 1; i++) {
        const Qa = Q[i - 1]!;
        const Qb = Q[i + 1]!;
        // 局所可変摩擦係数（H-W → D-W、現流速で再計算）
        const Ra = localDarcyF(Qa / A, D, C_hw) * dx / (2 * GRAVITY * D * A * A);
        const Rb = localDarcyF(Qb / A, D, C_hw) * dx / (2 * GRAVITY * D * A * A);
        const CP = H[i - 1]! + B * Qa - Ra * Qa * Math.abs(Qa);
        const CM = H[i + 1]! - B * Qb + Rb * Qb * Math.abs(Qb);
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

      const Q_N1 = Q[N - 1]!;
      const R_dn = localDarcyF(Q_N1 / A, D, C_hw) * dx / (2 * GRAVITY * D * A * A);
      CP_arr[pi] = H[N - 1]! + B * Q_N1 - R_dn * Q_N1 * Math.abs(Q_N1);

      const Q_1 = Q[1]!;
      const R_up = localDarcyF(Q_1 / A, D, C_hw) * dx / (2 * GRAVITY * D * A * A);
      CM_arr[pi] = H[1]! - B * Q_1 + R_up * Q_1 * Math.abs(Q_1);
    }

    // ── 3. 全ノードを一括処理 ───────────────────────────────────────────────
    const nodeHnew: Record<string, number> = {};
    // nodeQin[nodeId][k]  = nodeFlowIn[nodeId][k] の管路端での Q
    // nodeQout[nodeId][k] = nodeFlowOut[nodeId][k] の管路端での Q
    const nodeQin: Record<string, number[]> = {};
    const nodeQout: Record<string, number[]> = {};

    for (const nodeId of allNodeIds) {
      const bc = nodes[nodeId];
      const inPipes = nodeFlowIn[nodeId] ?? [];   // この node に流入する管路
      const outPipes = nodeFlowOut[nodeId] ?? [];  // この node から流出する管路

      let H_node: number;
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

      } else if (bc.type === "air_chamber") {
        // エアチャンバは単一流入管の末端（T字接合の場合は junction で処理）
        const pi = inPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const st = airChamberState[nodeId]!;
          const r = solveAirChamber(CP_arr[pi]!, physics[pi]!.B, dt_global, bc, st);
          H_node = r.H;
          Q_ins = [r.Q];
        }

      } else if (bc.type === "surge_tank") {
        const pi = inPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const st = surgeTankState[nodeId]!;
          const r = solveSurgeTank(CP_arr[pi]!, physics[pi]!.B, dt_global, bc, st);
          H_node = r.H;
          Q_ins = [r.Q];
        }

      } else if (bc.type === "air_release_valve") {
        const pi = inPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const r = solveAirReleaseValve(CP_arr[pi]!, physics[pi]!.B, bc);
          H_node = r.H;
          Q_ins = [r.Q];
        }

      } else if (bc.type === "pressure_reducing_valve") {
        // PRV は単一流入管
        const pi = inPipes[0];
        if (pi === undefined) { H_node = 0; } else {
          const r = solvePRV(CP_arr[pi]!, physics[pi]!.B, bc);
          H_node = r.H;
          Q_ins = [r.Q];
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
      for (let k = 0; k < outPipes.length; k++) {
        const pi = outPipes[k]!;
        Hnews[pi]![0] = H_node;
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
      }
      if (step % saveEvery === 0) {
        snapshotsArr[pi]!.push({ t, H: [...Hs[pi]!], Q: [...Qs[pi]!] });
      }
    }
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

  const network: MocNetwork = {
    pipes: [{ id: "pipe_0", pipe, waveSpeed, nReaches, upstreamNodeId: "upstream", downstreamNodeId: "downstream" }],
    nodes: {
      upstream: { type: "reservoir", head: HR },
      downstream: { type: "valve", Q0, H0v, closeTime, operation },
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

  const network: MocNetwork = {
    pipes: [{ id: "pipe_0", pipe, waveSpeed, nReaches, upstreamNodeId: "pump_node", downstreamNodeId: "dead_end_node" }],
    nodes: { pump_node: pumpBC, dead_end_node: { type: "dead_end" } },
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

  const network: MocNetwork = {
    pipes: [{ id: "pipe_0", pipe, waveSpeed, nReaches, upstreamNodeId: "pump_node", downstreamNodeId: "dead_end_node" }],
    nodes: {
      pump_node: {
        type: "pump", Q0: Q_rated, H0: pumpHead,
        ...(Hs !== undefined && { Hs }),
        shutdownTime: 0, mode: "start", startupTime, staticHead,
      },
      dead_end_node: { type: "dead_end" },
    },
  };

  return runMoc(network, { ...(tMax !== undefined && { tMax }), initialFlow: 0 });
}
