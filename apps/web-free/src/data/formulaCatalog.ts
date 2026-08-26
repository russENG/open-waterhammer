/**
 * 計算ライブラリ・カタログ — 単一の真理源（メタデータ）
 *
 * Stage 7（Python 移行 §計画）:
 * 「個別計算ロジックが追える」ことを保証するため、各計算式の
 *   - 表記（KaTeX）
 *   - 入出力
 *   - 適用条件
 *   - ソースコード位置（GitHub link）
 *   - 設計基準対応箇所
 * を集約する。LibraryPage と各 Calculator のインライン参照は
 * 本データを共通利用する。
 */

const REPO = "russENG/open-waterhammer";
const BRANCH = "master";

/** GitHub のソースリンクを構築 */
export function githubUrl(file: string, line?: number): string {
  const lineFrag = line !== undefined ? `#L${line}` : "";
  return `https://github.com/${REPO}/blob/${BRANCH}/${file}${lineFrag}`;
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export type FormulaCategory =
  | "wave-speed"        // 波速・振動周期・閉そく判定
  | "simple-formula"    // 単管路簡易式（Joukowsky/Allievi）
  | "steady-flow"       // 定常流摩擦損失
  | "empirical"         // 経験則
  | "moc"               // 特性曲線法
  | "design";           // 設計水圧・判定・単位変換

export interface FormulaInputDef {
  /** 記号（KaTeX 表記可） */
  symbol: string;
  /** 説明 */
  description: string;
  /** 単位 */
  unit: string;
}

export interface FormulaSource {
  /** リポジトリ相対パス */
  file: string;
  /** Python 関数名 */
  func: string;
  /** 行番号（おおよそ） */
  line?: number;
}

export interface FormulaReference {
  /** 基準ID */
  standardId: "nochi_pipeline_2021";
  /** 基準内位置（例: "技術書 式(8.3.6)"） */
  section: string;
  /** 基準照会ページのトピックID（あれば。referenceTopics.ts の id と整合） */
  topicId?: string;
}

export interface FormulaEntry {
  /** anchor ID（URL fragment 用） */
  id: string;
  /** カテゴリ */
  category: FormulaCategory;
  /** 表示タイトル */
  title: string;
  /** 1行サマリ */
  summary: string;
  /** displaystyle KaTeX 数式 */
  tex: string;
  /** 入力一覧 */
  inputs: FormulaInputDef[];
  /** 出力 */
  output: FormulaInputDef;
  /** 適用条件・適用範囲 */
  applicability: string;
  /** 補足（実装上の注意・近似誤差など、任意） */
  notes?: string;
  /** 参考基準 */
  references: FormulaReference[];
  /** 実装ソース */
  source: FormulaSource;
}

// ─── カテゴリ表示メタ ────────────────────────────────────────────────────────

export const CATEGORY_META: Record<FormulaCategory, { label: string; description: string; order: number }> = {
  "wave-speed": {
    label: "波速・閉そく判定",
    description: "管路波速 a、振動周期 T₀、急/緩閉そく区分（基準 §8.2）",
    order: 1,
  },
  "simple-formula": {
    label: "単管路の簡易式",
    description: "ジューコフスキー / アリエビ — 急閉そく・緩閉そく時の最大水撃圧（基準 §8.3.4）",
    order: 2,
  },
  "empirical": {
    label: "経験則による水撃圧",
    description: "給水栓を有する低圧水田用配水系などで用いる簡便式（基準 §8.3.5）",
    order: 3,
  },
  "steady-flow": {
    label: "定常流（摩擦損失）",
    description: "Hazen-Williams 式 / Darcy-Weisbach 式（基準 §7.2）",
    order: 4,
  },
  "moc": {
    label: "非定常解析（特性曲線法）",
    description: "特性曲線法 — 水路網の時系列水撃圧解析（基準 §8.4）",
    order: 5,
  },
  "design": {
    label: "設計水圧・判定・単位変換",
    description: "設計水圧の合成、許容圧との比較判定、水頭⇄MPa 変換",
    order: 6,
  },
};

// ─── カタログ本体 ────────────────────────────────────────────────────────────

const FORMULAS_PY = "packages/core-py/open_waterhammer/formulas.py";
const STEADY_PY = "packages/core-py/open_waterhammer/steady_flow.py";
const MOC_PY = "packages/core-py/open_waterhammer/moc.py";

export const FORMULA_CATALOG: FormulaEntry[] = [
  // ── 波速・閉そく判定 ───────────────────────────────────────────────────────
  {
    id: "wave-speed",
    category: "wave-speed",
    title: "波速 a",
    summary: "管路の弾性と水の圧縮性から圧力波の伝播速度を求める。Joukowsky/Allievi 式の前提となる基本量。",
    tex: String.raw`a = \dfrac{1}{\sqrt{\dfrac{w_0}{g}\left(\dfrac{1}{K} + \dfrac{D \cdot C_1}{E_s \cdot t}\right)}}`,
    inputs: [
      { symbol: "w_0", description: "水の単位体積重量", unit: "9.8 kN/m³" },
      { symbol: "g", description: "重力加速度", unit: "9.8 m/s²" },
      { symbol: "K", description: "水の体積弾性係数", unit: "2.03×10⁶ kN/m²" },
      { symbol: "D", description: "管内径", unit: "m" },
      { symbol: "t", description: "管厚", unit: "m" },
      { symbol: "E_s", description: "管材ヤング係数（短期）", unit: "kN/m²" },
      { symbol: "C_1", description: "埋設状況係数", unit: "[-] (既定 1.0)" },
    ],
    output: { symbol: "a", description: "波速", unit: "m/s" },
    applicability: "全管種共通。複合管や肉厚比 t/D ≪ 1 の薄肉管に対する基本式。",
    notes: "実装では PIPE_MATERIALS から管種別の Eₛ・C₁ 既定値を取得。Pipe 引数で個別オーバーライド可能。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.2.4)", topicId: "wave-speed" }],
    source: { file: FORMULAS_PY, func: "calc_wave_speed", line: 38 },
  },
  {
    id: "vibration-period",
    category: "wave-speed",
    title: "圧力振動周期 T₀",
    summary: "管路を圧力波が往復する時間の2倍。閉そく時間 tν との比 α = tν/T₀ で急/緩閉そくを区分する。",
    tex: String.raw`T_0 = \dfrac{4L}{a}`,
    inputs: [
      { symbol: "L", description: "管路延長", unit: "m" },
      { symbol: "a", description: "波速", unit: "m/s" },
    ],
    output: { symbol: "T_0", description: "圧力振動周期", unit: "s" },
    applicability: "単管路。多段口径管路では等価管路長を用いる。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.2.5)" }],
    source: { file: FORMULAS_PY, func: "calc_vibration_period", line: 62 },
  },
  {
    id: "closure-type",
    category: "wave-speed",
    title: "急/緩閉そく区分",
    summary: "操作時間 tν と圧力波往復時間 2L/a の大小で水撃圧の評価式を切り替える。",
    tex: String.raw`\alpha = \dfrac{t_\nu}{T_0}, \quad \begin{cases} \text{急閉そく} & \alpha \le 0.5\ (t_\nu \le 2L/a) \\ \text{緩閉そく} & \alpha > 0.5 \text{ かつ } t_\nu > L/300 \\ \text{数値解析要} & \text{上記以外} \end{cases}`,
    inputs: [
      { symbol: "t_\\nu", description: "等価閉そく時間", unit: "s" },
      { symbol: "T_0", description: "圧力振動周期 4L/a", unit: "s" },
      { symbol: "L", description: "管路延長", unit: "m" },
    ],
    output: { symbol: "\\text{区分}", description: "rapid / slow / numerical_required", unit: "—" },
    applicability: "単管路の最大水撃圧評価で式選択の前段。複雑な管路網では MOC を直接適用する。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 §8.2 / 式(8.2.6)" }],
    source: { file: FORMULAS_PY, func: "determine_closure_type", line: 70 },
  },

  // ── 単管路の簡易式 ─────────────────────────────────────────────────────────
  {
    id: "joukowsky",
    category: "simple-formula",
    title: "ジューコフスキーの式（急閉そく）",
    summary: "急閉そく（tν ≤ 2L/a）時の最大圧力上昇水頭。流速変化と波速の積に比例。",
    tex: String.raw`\Delta H = -\dfrac{a}{g}\,\Delta V`,
    inputs: [
      { symbol: "a", description: "波速", unit: "m/s" },
      { symbol: "\\Delta V", description: "流速変化（閉そく時 -V₀、開放時 +V₀）", unit: "m/s" },
      { symbol: "g", description: "重力加速度", unit: "9.8 m/s²" },
    ],
    output: { symbol: "\\Delta H", description: "圧力変化水頭（正で上昇、負で低下）", unit: "m" },
    applicability: "急閉そく（tν ≤ 2L/a）の単管路。柱分離や蒸気キャビテーションは対象外。",
    notes: "閉そく時 ΔV = -V₀ を代入すると ΔH = a·V₀/g（正値）。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.3.6)", topicId: "waterhammer-estimate" }],
    source: { file: FORMULAS_PY, func: "joukowsky", line: 109 },
  },
  {
    id: "allievi-k1",
    category: "simple-formula",
    title: "アリエビの定数 K₁",
    summary: "アリエビ近似式の無次元パラメータ。L·V₀ と g·H₀·tν の比。",
    tex: String.raw`K_1 = \dfrac{L\,V_0}{g\,H_0\,t_\nu}`,
    inputs: [
      { symbol: "L", description: "管路延長", unit: "m" },
      { symbol: "V_0", description: "初期流速", unit: "m/s" },
      { symbol: "H_0", description: "初期水頭（静水頭）", unit: "m" },
      { symbol: "t_\\nu", description: "等価閉そく時間", unit: "s" },
    ],
    output: { symbol: "K_1", description: "アリエビ定数", unit: "—" },
    applicability: "緩閉そく時のアリエビ近似式の前段計算。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.3.7) 直下" }],
    source: { file: FORMULAS_PY, func: "calc_allievi_k1", line: 129 },
  },
  {
    id: "allievi-close",
    category: "simple-formula",
    title: "アリエビ近似式（閉操作 Hmax）",
    summary: "緩閉そく（tν > 2L/a）時の最大水撃圧水頭。K₁ から非線形に決定する。",
    tex: String.raw`\dfrac{H_{\max}}{H_0} = \dfrac{K_1}{2} + \sqrt{\dfrac{K_1^2}{4} + K_1}`,
    inputs: [
      { symbol: "H_0", description: "初期水頭", unit: "m" },
      { symbol: "K_1", description: "アリエビ定数", unit: "—" },
    ],
    output: { symbol: "H_{\\max}", description: "最大水撃圧水頭", unit: "m" },
    applicability: "緩閉そく（tν > 2L/a かつ tν > L/300）の単管路、閉操作。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.3.7)", topicId: "waterhammer-estimate" }],
    source: { file: FORMULAS_PY, func: "allievi_close", line: 143 },
  },
  {
    id: "allievi-open",
    category: "simple-formula",
    title: "アリエビ近似式（開操作 Hmin）",
    summary: "開操作時の最小水頭。負値で得られる。",
    tex: String.raw`H_{\min} = H_0 \left(\dfrac{K_1}{2} - \sqrt{\dfrac{K_1^2}{4} + K_1}\right)`,
    inputs: [
      { symbol: "H_0", description: "初期水頭", unit: "m" },
      { symbol: "K_1", description: "アリエビ定数", unit: "—" },
    ],
    output: { symbol: "H_{\\min}", description: "最大圧力低下水頭（負値）", unit: "m" },
    applicability: "緩閉そくの単管路、開操作。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.3.8)" }],
    source: { file: FORMULAS_PY, func: "allievi_open", line: 160 },
  },
  {
    id: "equivalent-length",
    category: "simple-formula",
    title: "多段口径管路の等価管路長",
    summary: "径の異なる複数区間を、基準区間の流速で等価に置き換えた長さに換算する。",
    tex: String.raw`L_e = L_1 + L_2 \cdot \dfrac{A_1}{A_2} + L_3 \cdot \dfrac{A_1}{A_3} + \cdots`,
    inputs: [
      { symbol: "L_i", description: "各区間長", unit: "m" },
      { symbol: "A_i", description: "各区間管内断面積", unit: "m²" },
    ],
    output: { symbol: "L_e", description: "等価管路長", unit: "m" },
    applicability: "多段口径管路で簡易式（Joukowsky/Allievi）を適用する際の前処理。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.3.9)" }],
    source: { file: FORMULAS_PY, func: "calc_equivalent_length", line: 178 },
  },

  // ── 経験則 ────────────────────────────────────────────────────────────────
  {
    id: "empirical-waterhammer",
    category: "empirical",
    title: "経験則による水撃圧（系統別）",
    summary: "給水栓を有する水田用配水系で、5系統区分（自然圧送オープン/クローズド/セミ・クローズド、ポンプ配水槽/直送/圧力タンク）に応じた水撃圧の簡便評価。",
    tex: String.raw`\begin{aligned}
\text{自然圧送 オープン:}\quad &P_h = 0.20\,P_{HG} \\
\text{クローズド/セミ・クローズド:}\quad &P_h = \begin{cases} 1.00\,P_s & P_s < 0.35\ \text{MPa} \\ \max(0.40\,P_s,\ 0.35) & P_s \ge 0.35\ \text{MPa} \end{cases} \\
\text{ポンプ配水槽:}\quad &P_h = \begin{cases} 1.00\,P_{op} & P_{op} < 0.45\ \text{MPa} \\ \max(0.60\,P_{op},\ 0.45) & P_{op} \ge 0.45\ \text{MPa} \end{cases} \\
\text{ポンプ直送:}\quad &P_h = \begin{cases} 1.00\,P_s & P_s < 0.45\ \text{MPa} \\ \max(0.60\,P_s,\ 0.45) & P_s \ge 0.45\ \text{MPa} \end{cases} \\
\text{ポンプ圧力タンク:}\quad &P_h = \begin{cases} 1.00\,P_s & P_s < 0.35\ \text{MPa} \\ \max(0.40\,P_s,\ 0.35) & P_s \ge 0.35\ \text{MPa} \end{cases}
\end{aligned}`,
    inputs: [
      { symbol: "P_s", description: "静水圧", unit: "MPa" },
      { symbol: "P_{HG}", description: "動水勾配線水圧（オープンタイプのみ）", unit: "MPa" },
      { symbol: "P_{op}", description: "通水時水圧（配水槽方式のみ）", unit: "MPa" },
    ],
    output: { symbol: "P_h", description: "水撃圧", unit: "MPa" },
    applicability: "給水栓を有する水田用配水系で、静水圧 0.35MPa 未満またはオープンタイプの場合のみ推奨。それ以外は計算による方法（ジューコフスキー/アリエビ）を原則とする。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 §8.3.5", topicId: "waterhammer-estimate" }],
    source: { file: FORMULAS_PY, func: "calc_empirical_waterhammer", line: 257 },
  },

  // ── 定常流（摩擦損失） ───────────────────────────────────────────────────────
  {
    id: "hazen-williams",
    category: "steady-flow",
    title: "Hazen-Williams 式",
    summary: "管路の摩擦損失水頭を流速・粗度係数 C・動水半径から決定する。土地改良基準で標準採用。",
    tex: String.raw`V = 0.849\,C\,R^{0.63}\,I^{0.54} \quad \Rightarrow\quad I = \left(\dfrac{V}{0.849\,C\,R^{0.63}}\right)^{1/0.54}, \quad h_f = I\,L`,
    inputs: [
      { symbol: "V", description: "平均流速", unit: "m/s" },
      { symbol: "C", description: "Hazen-Williams 粗度係数", unit: "[-]" },
      { symbol: "R = D/4", description: "動水半径（円管）", unit: "m" },
      { symbol: "L", description: "管路延長", unit: "m" },
    ],
    output: { symbol: "h_f", description: "摩擦損失水頭", unit: "m" },
    applicability: "農業用パイプラインの定常流計算で標準採用。乱流域・水温20℃前後で精度が高い。",
    notes: "EPANET も同式を内蔵。本ツールでは epanet-js (WASM) と自前実装の両方を提供し、樹枝状網で数値一致を確認。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(7.2.2)", topicId: "steady-flow" }],
    source: { file: STEADY_PY, func: "calc_hazen_williams", line: 95 },
  },
  {
    id: "darcy-weisbach",
    category: "steady-flow",
    title: "Darcy-Weisbach 式",
    summary: "摩擦損失係数 f を用いた一般化された摩擦損失式。摩擦損失係数の決定には Moody 線図等を用いる。",
    tex: String.raw`h_f = f \cdot \dfrac{L}{D} \cdot \dfrac{V^2}{2g}`,
    inputs: [
      { symbol: "f", description: "摩擦損失係数", unit: "[-]" },
      { symbol: "L", description: "管路延長", unit: "m" },
      { symbol: "D", description: "管内径", unit: "m" },
      { symbol: "V", description: "平均流速", unit: "m/s" },
      { symbol: "g", description: "重力加速度", unit: "9.8 m/s²" },
    ],
    output: { symbol: "h_f", description: "摩擦損失水頭", unit: "m" },
    applicability: "原理に基づく一般式。f の決定には別途 Reynolds 数・相対粗度 ε/D が必要。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 §7.2 補遺" }],
    source: { file: STEADY_PY, func: "calc_darcy_weisbach", line: 39 },
  },

  // ── MOC（特性曲線法） ────────────────────────────────────────────────────
  {
    id: "moc-internal",
    category: "moc",
    title: "特性曲線法の内部点更新（C+ / C- 特性線）",
    summary: "管路内部点の水頭・流量を、上流からの C+ 不変量と下流からの C- 不変量の連立で時系列に更新する。",
    tex: String.raw`\begin{aligned}
C^+ : \quad& H_P = H_A - \dfrac{a}{gA}(Q_P - Q_A) - R\,Q_A|Q_A| \\
C^- : \quad& H_P = H_B + \dfrac{a}{gA}(Q_P - Q_B) + R\,Q_B|Q_B| \\
\Rightarrow\ & H_P = \dfrac{C^+_A + C^-_B}{2}, \quad Q_P = \dfrac{gA}{a}(H_P - H_A) + Q_A - R\,Q_A|Q_A|
\end{aligned}`,
    inputs: [
      { symbol: "H, Q", description: "水頭・流量（点 P が次時刻、A/B が現時刻の上下流）", unit: "m, m³/s" },
      { symbol: "a", description: "波速", unit: "m/s" },
      { symbol: "A", description: "管内断面積", unit: "m²" },
      { symbol: "R", description: "Darcy-Weisbach 摩擦項係数 f·dx/(2gDA²)", unit: "s/m⁵" },
    ],
    output: { symbol: "H_P, Q_P", description: "次時刻の水頭・流量", unit: "m, m³/s" },
    applicability: "MOC 解析の中核。境界条件（行き止まり・バルブ・ポンプ・エアチャンバ等）は別途各 BC で C+/C- のいずれかと連立する。CFL 条件 dx = a·dt が必要。",
    notes: "本実装は各 BC の水頭を 0 m で打ち切らない（下降側の水撃圧を過小評価しないため）。柱分離・蒸気キャビテーションは対象外で、動水頭が水蒸気圧水頭（既定 −10.33 m）を下回った場合は発生位置・時刻を警告で通知する。詳細は要旨「§4 適用条件および評価方法」参照。",
    references: [
      { standardId: "nochi_pipeline_2021", section: "技術書 §8.4（特性曲線法・中心差分法）", topicId: "moc" },
    ],
    source: { file: MOC_PY, func: "run_moc", line: 1 },
  },

  // ── 設計水圧・判定・単位変換 ────────────────────────────────────────────────
  {
    id: "design-pressure",
    category: "design",
    title: "設計水圧の合成",
    summary: "設計水圧は静水圧と水撃圧の和。",
    tex: String.raw`P_d = P_s + P_h`,
    inputs: [
      { symbol: "P_s", description: "静水圧", unit: "MPa" },
      { symbol: "P_h", description: "水撃圧", unit: "MPa" },
    ],
    output: { symbol: "P_d", description: "設計水圧", unit: "MPa" },
    applicability: "管種・管厚決定の入力として用いる。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 式(8.3.2)" }],
    source: { file: FORMULAS_PY, func: "calc_design_pressure", line: 198 },
  },
  {
    id: "design-judgement",
    category: "design",
    title: "設計水圧と許容圧の比較判定",
    summary: "設計水圧 ≤ 許容圧 × 0.9（OK）/ ≤ 許容圧（要注意）/ > 許容圧（NG）の3段階。",
    tex: String.raw`\begin{cases}
\text{OK} & P_d \le 0.9\,P_a\ (\text{余裕度} \ge 10\%) \\
\text{要注意} & 0.9\,P_a < P_d \le P_a\ (\text{余裕度} < 10\%) \\
\text{NG} & P_d > P_a
\end{cases}`,
    inputs: [
      { symbol: "P_d", description: "設計水圧", unit: "MPa" },
      { symbol: "P_a", description: "許容圧", unit: "MPa" },
    ],
    output: { symbol: "\\text{判定}", description: "ok / warning / ng", unit: "—" },
    applicability: "管種・管厚の選定で許容内圧との比較に用いる簡便判定。詳細検討時は安全率の設定を別途確認すること。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 §8.3.3 関連" }],
    source: { file: FORMULAS_PY, func: "judge_design_pressure", line: 209 },
  },
  {
    id: "head-mpa-conversion",
    category: "design",
    title: "水頭 [m] ⇄ 圧力 [MPa] 変換",
    summary: "水頭と圧力の換算。w₀ = 9.8 kN/m³ を採用。",
    tex: String.raw`P\,[\text{MPa}] = \dfrac{H\,[\text{m}] \times w_0}{1000}, \quad H\,[\text{m}] = \dfrac{P\,[\text{MPa}] \times 1000}{w_0}`,
    inputs: [
      { symbol: "H", description: "水頭", unit: "m" },
      { symbol: "P", description: "圧力", unit: "MPa" },
      { symbol: "w_0", description: "水の単位体積重量", unit: "9.8 kN/m³" },
    ],
    output: { symbol: "P, H", description: "対応する圧力 / 水頭", unit: "MPa, m" },
    applicability: "全般。",
    references: [{ standardId: "nochi_pipeline_2021", section: "技術書 §8 共通" }],
    source: { file: FORMULAS_PY, func: "head_to_mpa", line: 379 },
  },
];

/** ID から逆引き */
export function getFormulaById(id: string): FormulaEntry | undefined {
  return FORMULA_CATALOG.find(f => f.id === id);
}

/** カテゴリ別にグループ化 */
export function groupByCategory(): Map<FormulaCategory, FormulaEntry[]> {
  const map = new Map<FormulaCategory, FormulaEntry[]>();
  for (const f of FORMULA_CATALOG) {
    if (!map.has(f.category)) map.set(f.category, []);
    map.get(f.category)!.push(f);
  }
  return map;
}
