/**
 * 水撃圧計算コンポーネント
 * デモケースを選択して計算結果・数式をリアルタイム表示
 */

import { useState, useMemo } from "react";
import {
  runSimpleFormula,
  headToMpa,
  judgeDesignPressure,
  GRAVITY,
  BULK_MODULUS_WATER,
  WATER_UNIT_WEIGHT,
  PIPE_MATERIALS,
} from "@open-waterhammer/core";
import type { Pipe, CalculationCase, SimpleFormulaResult, JudgementResult } from "@open-waterhammer/core";
import {
  DEMO_CASE_01_PIPE,
  DEMO_CASE_01_CASE,
  DEMO_CASE_01_CLOSE_TIME,
  DEMO_CASE_02_PIPE,
  DEMO_CASE_02_CASE,
  DEMO_CASE_02_CLOSE_TIME,
} from "@open-waterhammer/sample-data";
import { Formula } from "./Formula";
import { ExcelPanel } from "./ExcelPanel";
import { PressureChart } from "./PressureChart";
import type { WorkbookData } from "@open-waterhammer/excel-io";

// ─── デモケース定義 ──────────────────────────────────────────────────────────

const DEMO_CASES = [
  {
    id: "01",
    label: "デモ01：バルブ急閉そく（ジューコフスキー式）",
    pipe: DEMO_CASE_01_PIPE,
    cas: DEMO_CASE_01_CASE,
    closeTime: DEMO_CASE_01_CLOSE_TIME,
  },
  {
    id: "02",
    label: "デモ02：バルブ緩閉そく（アリエビ式）",
    pipe: DEMO_CASE_02_PIPE,
    cas: DEMO_CASE_02_CASE,
    closeTime: DEMO_CASE_02_CLOSE_TIME,
  },
] as const;

// ─── 入力フォームの状態型 ────────────────────────────────────────────────────

interface FormState {
  innerDiameter: string;
  wallThickness: string;
  length: string;
  initialVelocity: string;
  initialHead: string;
  closeTime: string;
  allowablePressure: string;
}

function demoToForm(pipe: Pipe, cas: CalculationCase, closeTime: number): FormState {
  return {
    innerDiameter: String(pipe.innerDiameter * 1000),
    wallThickness: String(pipe.wallThickness * 1000),
    length: String(pipe.length),
    initialVelocity: String(cas.initialVelocity),
    initialHead: String(cas.initialHead),
    closeTime: String(closeTime),
    allowablePressure: "0.75",  // デフォルト: 0.75 MPa
  };
}

// ─── 数値フォーマット ─────────────────────────────────────────────────────────

function n(v: number, d = 2): string {
  return v.toFixed(d);
}

// ─── 数式カード ───────────────────────────────────────────────────────────────

function FormulaCard({
  refLabel,
  formula,
  substituted,
  result,
  note,
}: {
  refLabel: string;
  formula: string;       // 記号式 (KaTeX)
  substituted?: string;  // 数値代入 (KaTeX)
  result?: string;       // 結果行 (KaTeX)
  note?: string;         // 補足テキスト
}) {
  return (
    <div className="fcard">
      <div className="fcard-ref">{refLabel}</div>
      <div className="fcard-body">
        <div className="fcard-formula">
          <Formula tex={formula} display />
        </div>
        {substituted && (
          <div className="fcard-row fcard-row--sub">
            <span className="fcard-row-label">代入</span>
            <Formula tex={substituted} display />
          </div>
        )}
        {result && (
          <div className="fcard-row fcard-row--result">
            <span className="fcard-row-label">結果</span>
            <Formula tex={result} display />
          </div>
        )}
        {note && <div className="fcard-note">{note}</div>}
      </div>
    </div>
  );
}

// ─── 計算確認セクション ───────────────────────────────────────────────────────

function FormulaVerification({
  pipe,
  cas,
  closeTime,
  result,
}: {
  pipe: Pipe;
  cas: CalculationCase;
  closeTime: number;
  result: SimpleFormulaResult;
}) {
  const [open, setOpen] = useState(false);

  const Es = pipe.youngsModulus ?? PIPE_MATERIALS[pipe.pipeType].youngsModulusShort;
  const c1 = pipe.c1Coeff ?? 1.0;
  const D = pipe.innerDiameter;
  const t = pipe.wallThickness;
  const L = pipe.length;
  const V0 = cas.initialVelocity;
  const H0 = cas.initialHead;
  const a = result.waveSpeed.waveSpeed;
  const T0 = result.waveSpeed.vibrationPeriod;
  const twoLa = T0 / 2;

  // Eₛ 表示（kN/m²）
  const EsDisp = Es >= 1e6
    ? `${(Es / 1e6).toFixed(0)} \\times 10^6`
    : Es.toFixed(0);

  return (
    <section className="card formula-card">
      <button
        className="formula-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="formula-toggle-label">使用した計算式</span>
        <span className="formula-toggle-icon">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="formula-content">

          {/* ① 波速算定 */}
          <FormulaCard
            refLabel="① 波速算定（式 8.2.4）"
            formula={String.raw`a = \frac{1}{\sqrt{\dfrac{w_0}{g}\!\left(\dfrac{1}{K} + \dfrac{D \cdot C_1}{E_s \cdot t}\right)}}`}
            substituted={String.raw`a = \frac{1}{\sqrt{\dfrac{${WATER_UNIT_WEIGHT}}{${GRAVITY}}\!\left(\dfrac{1}{${(BULK_MODULUS_WATER / 1e6).toFixed(2)} \times 10^6} + \dfrac{${D} \times ${c1}}{${EsDisp} \times ${t}}\right)}}`}
            result={`a = ${n(a, 1)} \\text{ m/s}`}
          />

          {/* ② 閉そく判定 */}
          <FormulaCard
            refLabel="② 閉そく判定"
            formula={String.raw`\frac{2L}{a} = \frac{2 \times ${L}}{${n(a, 1)}} = ${n(twoLa, 3)} \text{ s}`}
            substituted={String.raw`t_\nu = ${n(closeTime, 1)} \text{ s} \quad ${closeTime <= twoLa ? "\\leq" : ">"} \quad \frac{2L}{a} = ${n(twoLa, 3)} \text{ s}`}
            result={
              result.closureType === "rapid"
                ? String.raw`\Rightarrow \text{急閉そく（ジューコフスキー式を適用）}`
                : result.closureType === "slow"
                ? String.raw`\Rightarrow \text{緩閉そく（アリエビ式を適用）}`
                : String.raw`\Rightarrow \text{数値解析が必要な領域}`
            }
          />

          {/* ③-A ジューコフスキー */}
          {result.closureType === "rapid" && result.deltaH_joukowsky !== undefined && (
            <FormulaCard
              refLabel="③ ジューコフスキーの式（式 8.3.6）"
              formula={String.raw`\Delta H = -\frac{a}{g} \cdot \Delta V = \frac{a}{g} \cdot V_0`}
              substituted={String.raw`\Delta H = \frac{${n(a, 1)}}{${GRAVITY}} \times ${V0}`}
              result={`\\Delta H = ${n(result.deltaH_joukowsky, 2)} \\text{ m}`}
              note={`最大水頭 H₀ + ΔH = ${n(H0 + result.deltaH_joukowsky, 2)} m`}
            />
          )}

          {/* ③-B アリエビ */}
          {result.closureType === "slow" && result.k1 !== undefined &&
            result.hmax_allievi_close !== undefined &&
            result.hmax_allievi_open !== undefined && (
            <>
              <FormulaCard
                refLabel="③-1 アリエビ式 K₁ 算定"
                formula={String.raw`K_1 = \frac{L \cdot V_0}{g \cdot H_0 \cdot t_\nu}`}
                substituted={String.raw`K_1 = \frac{${L} \times ${V0}}{${GRAVITY} \times ${H0} \times ${closeTime}}`}
                result={`K_1 = ${result.k1.toFixed(4)}`}
              />
              <FormulaCard
                refLabel="③-2 アリエビ式 最大水撃圧（式 8.3.7）"
                formula={String.raw`H_{max} = \frac{H_0}{2}\!\left(K_1 + \sqrt{K_1^2 + 4}\right)`}
                substituted={String.raw`H_{max} = \frac{${H0}}{2}\!\left(${result.k1.toFixed(4)} + \sqrt{${result.k1.toFixed(4)}^2 + 4}\right)`}
                result={`H_{max} = ${n(result.hmax_allievi_close, 2)} \\text{ m（閉操作）}`}
              />
              <FormulaCard
                refLabel="③-3 アリエビ式 最大圧力低下（式 8.3.8）"
                formula={String.raw`H_{min} = \frac{H_0}{2}\!\left(K_1 - \sqrt{K_1^2 + 4}\right)`}
                substituted={String.raw`H_{min} = \frac{${H0}}{2}\!\left(${result.k1.toFixed(4)} - \sqrt{${result.k1.toFixed(4)}^2 + 4}\right)`}
                result={`H_{min} = ${n(result.hmax_allievi_open, 2)} \\text{ m（開操作）}`}
              />
            </>
          )}

          {/* ④ 設計水圧 */}
          {result.closureType !== "numerical_required" && (() => {
            const hammerHead = result.deltaH_joukowsky !== undefined
              ? result.deltaH_joukowsky
              : (result.hmax_allievi_close ?? H0) - H0;
            const totalHead = H0 + hammerHead;
            const designMpa = headToMpa(totalHead);
            const staticMpa = headToMpa(H0);
            return (
              <FormulaCard
                refLabel="④ 設計水圧（式 8.3.2）"
                formula={String.raw`P = \frac{(H_0 + \Delta H) \cdot w_0}{1000}`}
                substituted={String.raw`P = \frac{(${n(H0)} + ${n(hammerHead)}) \times ${WATER_UNIT_WEIGHT}}{1000}`}
                result={`P = ${staticMpa.toFixed(3)} + ${(designMpa - staticMpa).toFixed(3)} = ${designMpa.toFixed(3)} \\text{ MPa}`}
                note={`静水圧 ${staticMpa.toFixed(3)} MPa ＋ 水撃圧 ${(designMpa - staticMpa).toFixed(3)} MPa`}
              />
            );
          })()}

          <div className="formula-params">
            <div className="formula-params-title">使用定数・管材パラメータ</div>
            <div className="formula-params-grid">
              <div><Formula tex={`g = ${GRAVITY} \\text{ m/s}^2`} /></div>
              <div><Formula tex={`w_0 = ${WATER_UNIT_WEIGHT} \\text{ kN/m}^3`} /></div>
              <div><Formula tex={`K = ${(BULK_MODULUS_WATER / 1e6).toFixed(2)} \\times 10^6 \\text{ kN/m}^2`} /></div>
              <div><Formula tex={`E_s = ${EsDisp} \\text{ kN/m}^2 \\text{（${pipe.pipeType}）}`} /></div>
              <div><Formula tex={`C_1 = ${c1} \\text{（埋設状況係数）}`} /></div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── 結果表示サブコンポーネント ──────────────────────────────────────────────

function ResultRow({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`result-row${highlight ? " result-row--highlight" : ""}`}>
      <span className="result-label">{label}</span>
      <span className="result-value">
        {value}
        {unit && <span className="result-unit"> {unit}</span>}
      </span>
    </div>
  );
}

function ClosureBadge({ type }: { type: SimpleFormulaResult["closureType"] }) {
  const map = {
    rapid: { label: "急閉そく", cls: "badge badge--rapid" },
    slow: { label: "緩閉そく", cls: "badge badge--slow" },
    numerical_required: { label: "数値解析要", cls: "badge badge--numerical" },
  } as const;
  const { label, cls } = map[type];
  return <span className={cls}>{label}</span>;
}

// ─── メインコンポーネント ────────────────────────────────────────────────────

export function WaterhammerCalculator() {
  const [selectedDemo, setSelectedDemo] = useState<"01" | "02">("01");
  const [form, setForm] = useState<FormState>(() =>
    demoToForm(DEMO_CASE_01_PIPE, DEMO_CASE_01_CASE, DEMO_CASE_01_CLOSE_TIME)
  );
  // Excel から読み込んだ管路・ケース選択肢
  const [excelPipes, setExcelPipes] = useState<Pipe[]>([]);
  const [excelCases, setExcelCases] = useState<CalculationCase[]>([]);
  const [selectedExcelCase, setSelectedExcelCase] = useState<string>("");
  const [inputSource, setInputSource] = useState<"demo" | "excel">("demo");

  function handleDemoChange(id: "01" | "02") {
    setSelectedDemo(id);
    const demo = DEMO_CASES.find((d) => d.id === id)!;
    setForm(demoToForm(demo.pipe, demo.cas, demo.closeTime));
  }

  function handleField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // Excel 読み込み完了時: 最初のケースをフォームに反映
  function handleExcelLoad(data: WorkbookData) {
    setExcelPipes(data.pipes);
    setExcelCases(data.cases);
    setInputSource("excel");
    if (data.cases.length > 0 && data.pipes.length > 0) {
      const cas = data.cases[0]!;
      const pipe = data.pipes[0]!;
      setSelectedExcelCase(cas.id);
      setForm((prev) => ({
        ...prev,
        innerDiameter: String(pipe.innerDiameter * 1000),
        wallThickness: String(pipe.wallThickness * 1000),
        length: String(pipe.length),
        initialVelocity: String(cas.initialVelocity),
        initialHead: String(cas.initialHead),
        closeTime: "1.0", // Excel にはまだ closeTime なし → デフォルト
      }));
    }
  }

  // Excel ケース切替
  function handleExcelCaseChange(caseId: string) {
    setSelectedExcelCase(caseId);
    const cas = excelCases.find((c) => c.id === caseId);
    const pipe = excelPipes[0];
    if (cas && pipe) {
      setForm((prev) => ({
        ...prev,
        initialVelocity: String(cas.initialVelocity),
        initialHead: String(cas.initialHead),
      }));
    }
  }

  const parsed = useMemo(() => {
    let basePipe: Pipe;
    let baseCas: CalculationCase;

    if (inputSource === "excel" && excelPipes.length > 0 && excelCases.length > 0) {
      basePipe = excelPipes[0]!;
      baseCas = excelCases.find((c) => c.id === selectedExcelCase) ?? excelCases[0]!;
    } else {
      const demo = DEMO_CASES.find((d) => d.id === selectedDemo)!;
      basePipe = demo.pipe;
      baseCas = demo.cas;
    }

    const pipe: Pipe = {
      ...basePipe,
      innerDiameter: parseFloat(form.innerDiameter) / 1000,
      wallThickness: parseFloat(form.wallThickness) / 1000,
      length: parseFloat(form.length),
    };
    const cas: CalculationCase = {
      ...baseCas,
      initialVelocity: parseFloat(form.initialVelocity),
      initialHead: parseFloat(form.initialHead),
    };
    const closeTime = parseFloat(form.closeTime);
    const valid = ![pipe.innerDiameter, pipe.wallThickness, pipe.length, cas.initialVelocity, cas.initialHead, closeTime].some(isNaN);
    return { pipe, cas, closeTime, valid };
  }, [form, selectedDemo, inputSource, excelPipes, excelCases, selectedExcelCase]);

  const result = useMemo<SimpleFormulaResult | null>(() => {
    if (!parsed.valid) return null;
    try {
      return runSimpleFormula(parsed.pipe, parsed.cas, parsed.closeTime);
    } catch {
      return null;
    }
  }, [parsed]);

  const designPressureMpa = useMemo(() => {
    if (!result) return null;
    const H0 = parsed.cas.initialHead;
    let hammerHead = 0;
    if (result.deltaH_joukowsky !== undefined) hammerHead = result.deltaH_joukowsky;
    else if (result.hmax_allievi_close !== undefined) hammerHead = result.hmax_allievi_close - H0;
    return headToMpa(H0 + hammerHead);
  }, [result, parsed]);

  const staticMpa = useMemo(() => {
    if (!parsed.valid) return 0;
    return headToMpa(parsed.cas.initialHead);
  }, [parsed]);

  const hammerMpa = useMemo(() => {
    if (!result || !designPressureMpa) return 0;
    return designPressureMpa - headToMpa(parsed.cas.initialHead);
  }, [result, designPressureMpa, parsed]);

  const judgement = useMemo<JudgementResult | null>(() => {
    if (!designPressureMpa || result?.closureType === "numerical_required") return null;
    const allowable = parseFloat(form.allowablePressure);
    if (isNaN(allowable) || allowable <= 0) return null;
    return judgeDesignPressure(designPressureMpa, allowable);
  }, [designPressureMpa, form.allowablePressure, result]);

  return (
    <div className="calculator">
      {/* Excel 入出力パネル */}
      <ExcelPanel onLoad={handleExcelLoad} />

      <section className="card">
        <h2 className="card-title">計算ケース選択</h2>

        {/* ソース切替 */}
        <div className="source-tabs">
          <button
            className={`source-tab${inputSource === "demo" ? " source-tab--active" : ""}`}
            onClick={() => {
              setInputSource("demo");
              handleDemoChange(selectedDemo);
            }}
          >
            デモデータ
          </button>
          <button
            className={`source-tab${inputSource === "excel" ? " source-tab--active" : ""}`}
            onClick={() => setInputSource("excel")}
            disabled={excelCases.length === 0}
          >
            Excel 読み込みデータ {excelCases.length > 0 ? `(${excelCases.length}件)` : ""}
          </button>
        </div>

        {inputSource === "demo" && (
          <>
            <div className="demo-tabs" style={{ marginTop: 12 }}>
              {DEMO_CASES.map((demo) => (
                <button
                  key={demo.id}
                  className={`demo-tab${selectedDemo === demo.id ? " demo-tab--active" : ""}`}
                  onClick={() => handleDemoChange(demo.id)}
                >
                  {demo.label}
                </button>
              ))}
            </div>
            <p className="demo-note">
              ※ デモデータが入力済みです。値を変更するとリアルタイムに再計算されます。
            </p>
          </>
        )}

        {inputSource === "excel" && excelCases.length > 0 && (
          <div className="excel-case-select" style={{ marginTop: 12 }}>
            <label className="input-label">ケース選択</label>
            <select
              className="input"
              value={selectedExcelCase}
              onChange={(e) => handleExcelCaseChange(e.target.value)}
            >
              {excelCases.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <div className="calculator-body">
        <section className="card">
          <h2 className="card-title">入力パラメータ</h2>
          <div className="input-group">
            <h3 className="input-group-title">管路諸元</h3>
            <div className="input-grid">
              <InputField label="管内径 D" unit="mm" value={form.innerDiameter} onChange={(v) => handleField("innerDiameter", v)} />
              <InputField label="管厚 t" unit="mm" value={form.wallThickness} onChange={(v) => handleField("wallThickness", v)} />
              <InputField label="管路延長 L" unit="m" value={form.length} onChange={(v) => handleField("length", v)} />
            </div>
          </div>
          <div className="input-group">
            <h3 className="input-group-title">定常状態</h3>
            <div className="input-grid">
              <InputField label="初期流速 V₀" unit="m/s" value={form.initialVelocity} onChange={(v) => handleField("initialVelocity", v)} />
              <InputField label="静水頭 H₀" unit="m" value={form.initialHead} onChange={(v) => handleField("initialHead", v)} />
            </div>
          </div>
          <div className="input-group">
            <h3 className="input-group-title">操作条件</h3>
            <div className="input-grid">
              <InputField label="等価閉そく時間 tν" unit="s" value={form.closeTime} onChange={(v) => handleField("closeTime", v)} />
            </div>
          </div>
          <div className="input-group">
            <h3 className="input-group-title">耐圧判定</h3>
            <div className="input-grid">
              <InputField label="許容圧力（呼び圧力）" unit="MPa" value={form.allowablePressure} onChange={(v) => handleField("allowablePressure", v)} />
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">計算結果</h2>
          {result ? (
            <>
              {result.warnings.length > 0 && (
                <div className="warnings">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="warning-item">
                      <span className="warning-icon">⚠</span>
                      {w}
                    </div>
                  ))}
                </div>
              )}
              <div className="result-section">
                <h3 className="result-section-title">圧力波速</h3>
                <ResultRow label="波速 a" value={result.waveSpeed.waveSpeed.toFixed(1)} unit="m/s" />
                <ResultRow label="圧力振動周期 T₀" value={result.waveSpeed.vibrationPeriod.toFixed(3)} unit="s" />
                <ResultRow label="2L/a（基準時間）" value={(result.waveSpeed.vibrationPeriod / 2).toFixed(3)} unit="s" />
              </div>
              <div className="result-section">
                <h3 className="result-section-title">閉そく判定</h3>
                <div className="result-row">
                  <span className="result-label">閉そく区分</span>
                  <ClosureBadge type={result.closureType} />
                </div>
              </div>
              <div className="result-section">
                <h3 className="result-section-title">水撃圧</h3>
                {result.closureType === "rapid" && result.deltaH_joukowsky !== undefined && (
                  <>
                    <ResultRow label="適用式" value="ジューコフスキーの式（式8.3.6）" />
                    <ResultRow label="水撃圧水頭 ΔH" value={result.deltaH_joukowsky.toFixed(2)} unit="m" highlight />
                    <ResultRow label="最大水頭 H₀ + ΔH" value={(parsed.cas.initialHead + result.deltaH_joukowsky).toFixed(2)} unit="m" />
                  </>
                )}
                {result.closureType === "slow" && result.hmax_allievi_close !== undefined && (
                  <>
                    <ResultRow label="適用式" value="アリエビの近似式（式8.3.7/8.3.8）" />
                    {result.k1 !== undefined && <ResultRow label="K₁値" value={result.k1.toFixed(4)} />}
                    <ResultRow label="最大水頭 Hmax（閉）" value={result.hmax_allievi_close.toFixed(2)} unit="m" highlight />
                    {result.hmax_allievi_open !== undefined && (
                      <ResultRow label="最小水頭 Hmin（開）" value={result.hmax_allievi_open.toFixed(2)} unit="m" />
                    )}
                  </>
                )}
                {result.closureType === "numerical_required" && (
                  <div className="result-note">数値解析が必要なため簡易式の結果は表示されません。</div>
                )}
              </div>
              {designPressureMpa !== null && result.closureType !== "numerical_required" && (
                <div className="result-section">
                  <h3 className="result-section-title">設計水圧</h3>
                  <ResultRow label="静水圧" value={headToMpa(parsed.cas.initialHead).toFixed(3)} unit="MPa" />
                  <ResultRow label="設計水圧（静水圧 + 水撃圧）" value={designPressureMpa.toFixed(3)} unit="MPa" highlight />
                </div>
              )}
              {/* 耐圧判定 */}
              {judgement && (
                <div className={`judgement judgement--${judgement.status}`}>
                  <div className="judgement-badge">
                    {judgement.status === "ok" && "OK"}
                    {judgement.status === "warning" && "要確認"}
                    {judgement.status === "ng" && "NG"}
                  </div>
                  <div className="judgement-body">
                    <div className="judgement-message">{judgement.message}</div>
                    <div className="judgement-bar-wrap">
                      <div
                        className="judgement-bar-fill"
                        style={{ width: `${Math.min(judgement.designPressureMpa / judgement.allowablePressureMpa * 100, 100).toFixed(1)}%` }}
                      />
                      <div className="judgement-bar-limit" />
                    </div>
                    <div className="judgement-bar-labels">
                      <span>0</span>
                      <span>設計 {judgement.designPressureMpa.toFixed(3)} MPa</span>
                      <span>許容 {judgement.allowablePressureMpa.toFixed(3)} MPa</span>
                    </div>
                  </div>
                </div>
              )}

              {designPressureMpa !== null && result.closureType !== "numerical_required" && (
                <PressureChart
                  staticMpa={staticMpa}
                  hammerMpa={hammerMpa}
                  judgement={judgement}
                />
              )}

              <div className="result-footer">
                <span className="result-standard">
                  準拠: 土地改良設計基準パイプライン（令和3年6月改訂）
                </span>
              </div>
            </>
          ) : (
            <div className="result-empty">入力値を確認してください。</div>
          )}
        </section>
      </div>

      {result && (
        <FormulaVerification
          pipe={parsed.pipe}
          cas={parsed.cas}
          closeTime={parsed.closeTime}
          result={result}
        />
      )}
    </div>
  );
}

// ─── 入力フィールドコンポーネント ───────────────────────────────────────────

function InputField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="input-field">
      <label className="input-label">{label}</label>
      <div className="input-control">
        <input
          type="number"
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step="any"
        />
        <span className="input-unit">{unit}</span>
      </div>
    </div>
  );
}
