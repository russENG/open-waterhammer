/**
 * 定常流水理計算パネル
 * - 簡易計算: Darcy-Weisbach / Hazen-Williams 式（1区間）
 * - 縦断計算: 測点ベースの公式帳票形式（成果品様式準拠）
 */

import { useState, useMemo, useEffect } from "react";
import {
  calcDarcyWeisbach,
  calcHazenWilliams,
  calcLongitudinalHydraulic,
} from "@open-waterhammer/core";
import type {
  SteadyFlowResult,
  MeasurementPoint,
  LongitudinalHydraulicInput,
  LongitudinalHydraulicResult,
} from "@open-waterhammer/core";
import type { WorkbookData } from "@open-waterhammer/excel-io";

type Method = "hazen-williams" | "darcy-weisbach";
type Mode = "simple" | "longitudinal";

interface FormState {
  innerDiameter: string;
  length: string;
  flowRate: string;
  upstreamElevation: string;
  downstreamElevation: string;
  roughnessC: string;
  frictionFactor: string;
}

const DEFAULT_FORM: FormState = {
  innerDiameter: "300",
  length: "500",
  flowRate: "0.05",
  upstreamElevation: "50",
  downstreamElevation: "40",
  roughnessC: "130",
  frictionFactor: "0.02",
};

function n(v: number, d = 3): string {
  return v.toFixed(d);
}

// ─── 縦断計算の入力フォーム ─────────────────────────────────────────────────

interface LongFormState {
  staticWaterLevel: string;
  waterhammerMode: "ratio" | "fixed";
  waterhammerRatio: string;
  waterhammerFixed: string;
  caseName: string;
}

const DEFAULT_LONG_FORM: LongFormState = {
  staticWaterLevel: "580.600",
  waterhammerMode: "ratio",
  waterhammerRatio: "0.4",
  waterhammerFixed: "0.41",
  caseName: "計画最大流量",
};

// ─── メインコンポーネント ────────────────────────────────────────────────────

export interface SteadyFlowCalculatorProps {
  excelData?: WorkbookData | null;
  /** 縦断計算の入力・結果を親に通知（セッション保存用） */
  onLongResult?: (input: LongitudinalHydraulicInput | null, result: LongitudinalHydraulicResult | null) => void;
}

export function SteadyFlowCalculator({ excelData, onLongResult }: SteadyFlowCalculatorProps) {
  const excelPipes = excelData?.pipes ?? [];
  const excelPoints = excelData?.measurementPoints ?? [];
  const hasPoints = excelPoints.length > 0;

  const [mode, setMode] = useState<Mode>(hasPoints ? "longitudinal" : "simple");
  const [method, setMethod] = useState<Method>("hazen-williams");
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [longForm, setLongForm] = useState<LongFormState>(DEFAULT_LONG_FORM);

  // Excel データが読み込まれたら管路諸元を反映（簡易計算用）
  const [lastExcelLen, setLastExcelLen] = useState(0);
  if (excelPipes.length > 0 && excelPipes.length !== lastExcelLen) {
    setLastExcelLen(excelPipes.length);
    const pipe = excelPipes[0]!;
    setForm((prev) => ({
      ...prev,
      innerDiameter: String(pipe.innerDiameter * 1000),
      length: String(pipe.length),
      roughnessC: String(pipe.roughnessCoeff),
    }));
  }

  // 測点データが読み込まれたらモード切替
  const [lastPointLen, setLastPointLen] = useState(0);
  if (excelPoints.length > 0 && excelPoints.length !== lastPointLen) {
    setLastPointLen(excelPoints.length);
    setMode("longitudinal");
  }

  function handleField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleLongField(field: keyof LongFormState, value: string) {
    setLongForm((prev) => ({ ...prev, [field]: value }));
  }

  // ─── 簡易計算 ───────────────────────────────────────────────────────────

  const simpleResult = useMemo<SteadyFlowResult | null>(() => {
    const D = parseFloat(form.innerDiameter) / 1000;
    const L = parseFloat(form.length);
    const Q = parseFloat(form.flowRate);
    const upEl = parseFloat(form.upstreamElevation);
    const downEl = parseFloat(form.downstreamElevation);

    if ([D, L, Q, upEl, downEl].some(isNaN) || D <= 0 || L <= 0 || Q <= 0) return null;

    try {
      if (method === "hazen-williams") {
        const C = parseFloat(form.roughnessC);
        if (isNaN(C) || C <= 0) return null;
        return calcHazenWilliams({
          innerDiameter: D, length: L, flowRate: Q,
          upstreamElevation: upEl, downstreamElevation: downEl, roughnessC: C,
        });
      } else {
        const f = parseFloat(form.frictionFactor);
        if (isNaN(f) || f <= 0) return null;
        return calcDarcyWeisbach({
          innerDiameter: D, length: L, flowRate: Q,
          upstreamElevation: upEl, downstreamElevation: downEl, frictionFactor: f,
        });
      }
    } catch {
      return null;
    }
  }, [form, method]);

  // ─── 縦断計算 ───────────────────────────────────────────────────────────

  const longInput = useMemo<LongitudinalHydraulicInput | null>(() => {
    if (excelPoints.length === 0) return null;
    const swl = parseFloat(longForm.staticWaterLevel);
    if (isNaN(swl)) return null;

    const input: LongitudinalHydraulicInput = {
      points: excelPoints,
      staticWaterLevel: swl,
      caseName: longForm.caseName || "計画最大流量",
    };

    if (longForm.waterhammerMode === "fixed") {
      const v = parseFloat(longForm.waterhammerFixed);
      if (!isNaN(v)) input.waterhammerPressureMpa = v;
    } else {
      const r = parseFloat(longForm.waterhammerRatio);
      if (!isNaN(r)) input.waterhammerRatio = r;
    }
    return input;
  }, [excelPoints, longForm]);

  const longResult = useMemo<LongitudinalHydraulicResult | null>(() => {
    if (!longInput) return null;
    try {
      return calcLongitudinalHydraulic(longInput);
    } catch {
      return null;
    }
  }, [longInput]);

  // 親へ通知（セッション保存用）
  useEffect(() => {
    onLongResult?.(longInput, longResult);
  }, [longInput, longResult, onLongResult]);

  // ─── レンダリング ───────────────────────────────────────────────────────

  return (
    <div className="calculator">
      <section className="card">
        <h2 className="card-title">定常流水理計算</h2>

        {/* モード切替 */}
        <div className="source-tabs">
          <button
            className={`source-tab${mode === "simple" ? " source-tab--active" : ""}`}
            onClick={() => setMode("simple")}
          >
            簡易計算（1区間）
          </button>
          <button
            className={`source-tab${mode === "longitudinal" ? " source-tab--active" : ""}`}
            onClick={() => setMode("longitudinal")}
            disabled={!hasPoints}
            title={hasPoints ? "" : "Excelテンプレートの「測点データ」シートを読み込んでください"}
          >
            縦断計算（成果品様式）
            {!hasPoints && <span className="source-tab-badge">要Excel</span>}
          </button>
        </div>

        {mode === "simple" ? (
          <SimpleCalculatorPanel
            method={method}
            setMethod={setMethod}
            form={form}
            handleField={handleField}
            result={simpleResult}
          />
        ) : (
          <LongitudinalCalculatorPanel
            points={excelPoints}
            longForm={longForm}
            handleLongField={handleLongField}
            result={longResult}
          />
        )}
      </section>
    </div>
  );
}

// ─── 簡易計算パネル ──────────────────────────────────────────────────────────

function SimpleCalculatorPanel({
  method, setMethod, form, handleField, result,
}: {
  method: Method;
  setMethod: (m: Method) => void;
  form: FormState;
  handleField: (field: keyof FormState, value: string) => void;
  result: SteadyFlowResult | null;
}) {
  return (
    <div className="calculator-body">
      {/* 計算式選択 */}
      <div className="source-tabs" style={{ marginTop: 12 }}>
        <button
          className={`source-tab${method === "hazen-williams" ? " source-tab--active" : ""}`}
          onClick={() => setMethod("hazen-williams")}
        >
          Hazen-Williams 式
        </button>
        <button
          className={`source-tab${method === "darcy-weisbach" ? " source-tab--active" : ""}`}
          onClick={() => setMethod("darcy-weisbach")}
        >
          Darcy-Weisbach 式
        </button>
      </div>

      {/* 入力 */}
      <section className="card">
        <h2 className="card-title">入力パラメータ</h2>
        <div className="input-group">
          <h3 className="input-group-title">管路諸元</h3>
          <div className="input-grid">
            <InputField label="管内径 D" unit="mm" value={form.innerDiameter} onChange={(v) => handleField("innerDiameter", v)} />
            <InputField label="管路延長 L" unit="m" value={form.length} onChange={(v) => handleField("length", v)} />
          </div>
        </div>
        <div className="input-group">
          <h3 className="input-group-title">流量</h3>
          <div className="input-grid">
            <InputField label="設計流量 Q" unit="m3/s" value={form.flowRate} onChange={(v) => handleField("flowRate", v)} />
          </div>
        </div>
        <div className="input-group">
          <h3 className="input-group-title">標高</h3>
          <div className="input-grid">
            <InputField label="上流側標高" unit="m" value={form.upstreamElevation} onChange={(v) => handleField("upstreamElevation", v)} />
            <InputField label="下流側標高" unit="m" value={form.downstreamElevation} onChange={(v) => handleField("downstreamElevation", v)} />
          </div>
        </div>
        <div className="input-group">
          <h3 className="input-group-title">
            {method === "hazen-williams" ? "粗度係数" : "摩擦損失係数"}
          </h3>
          <div className="input-grid">
            {method === "hazen-williams" ? (
              <InputField label="Hazen-Williams C" unit="" value={form.roughnessC} onChange={(v) => handleField("roughnessC", v)} />
            ) : (
              <InputField label="摩擦損失係数 f" unit="" value={form.frictionFactor} onChange={(v) => handleField("frictionFactor", v)} />
            )}
          </div>
          {method === "hazen-williams" && (
            <p className="demo-note">
              C値の目安：鋼管 120、ダクタイル鋳鉄管 130、塩ビ管 140、ポリエチ���ン管 140
            </p>
          )}
        </div>
      </section>

      {/* 結果 */}
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
              <h3 className="result-section-title">流速・断面</h3>
              <ResultRow label="管内断面積 A" value={n(result.area, 4)} unit="m2" />
              <ResultRow label="平均流速 V" value={n(result.velocity, 2)} unit="m/s"
                highlight={result.velocity < 0.5 || result.velocity > 2.5} />
              <ResultRow label="速度水頭 V2/2g" value={n(result.velocityHead, 3)} unit="m" />
            </div>
            <div className="result-section">
              <h3 className="result-section-title">損失水頭</h3>
              <ResultRow label="摩擦損失水頭 hf" value={n(result.frictionLoss, 2)} unit="m" highlight />
              <ResultRow label="動水勾配 I" value={n(result.hydraulicGradient, 5)} unit="" />
              <ResultRow label="動水勾配 (permil)" value={n(result.hydraulicGradient * 1000, 2)} unit="" />
            </div>
            <div className="result-section">
              <h3 className="result-section-title">揚程</h3>
              <ResultRow label="高低差（下流 - 上流）" value={n(result.elevationDiff, 1)} unit="m" />
              <ResultRow label="必要全揚程" value={n(result.totalHead, 2)} unit="m" highlight />
              {result.totalHead <= 0 && (
                <div className="result-note">自然流下で送水可能です（余裕水頭 {n(Math.abs(result.totalHead), 2)} m）</div>
              )}
              {result.totalHead > 0 && (
                <div className="result-note">ポンプ揚程として {n(result.totalHead, 2)} m 以上が必要です</div>
              )}
            </div>
            <div className="result-footer">
              <span className="result-standard">
                計算式: {result.method === "hazen-williams" ? "Hazen-Williams 式" : "Darcy-Weisbach 式"}
              </span>
            </div>
          </>
        ) : (
          <div className="result-empty">入力値を確認してください。</div>
        )}
      </section>
    </div>
  );
}

// ─── 縦断計算パネル ──────────────────────────────────────────────────────────

function LongitudinalCalculatorPanel({
  points, longForm, handleLongField, result,
}: {
  points: MeasurementPoint[];
  longForm: LongFormState;
  handleLongField: (field: keyof LongFormState, value: string) => void;
  result: LongitudinalHydraulicResult | null;
}) {
  return (
    <div className="calculator-body">
      {/* 入力条件 */}
      <section className="card">
        <h2 className="card-title">縦断計算条件</h2>
        <div className="input-group">
          <div className="input-grid">
            <InputField
              label="静水位 (HWL)"
              unit="m"
              value={longForm.staticWaterLevel}
              onChange={(v) => handleLongField("staticWaterLevel", v)}
            />
            <InputField
              label="ケース名"
              unit=""
              value={longForm.caseName}
              onChange={(v) => handleLongField("caseName", v)}
              type="text"
            />
          </div>
        </div>
        <div className="input-group">
          <h3 className="input-group-title">水撃圧の設定</h3>
          <div className="source-tabs" style={{ marginBottom: 8 }}>
            <button
              className={`source-tab${longForm.waterhammerMode === "ratio" ? " source-tab--active" : ""}`}
              onClick={() => handleLongField("waterhammerMode", "ratio")}
            >
              静水圧比率
            </button>
            <button
              className={`source-tab${longForm.waterhammerMode === "fixed" ? " source-tab--active" : ""}`}
              onClick={() => handleLongField("waterhammerMode", "fixed")}
            >
              固定値 [MPa]
            </button>
          </div>
          <div className="input-grid">
            {longForm.waterhammerMode === "ratio" ? (
              <InputField
                label="水撃圧/静水圧 比率"
                unit=""
                value={longForm.waterhammerRatio}
                onChange={(v) => handleLongField("waterhammerRatio", v)}
              />
            ) : (
              <InputField
                label="水撃圧"
                unit="MPa"
                value={longForm.waterhammerFixed}
                onChange={(v) => handleLongField("waterhammerFixed", v)}
              />
            )}
          </div>
          <p className="demo-note">
            {longForm.waterhammerMode === "ratio"
              ? "経験則による目安: 自然圧送セミクローズド 0.4、ポンプ直送 0.6。別途 Step 2〜4 の計算結果で更新してください。"
              : "Step 2〜4 で算定した水撃圧値を入力してください。"}
          </p>
        </div>
        <div className="long-calc-summary">
          測点データ: {points.length} 点（Excel「測点データ」シートより読込済）
        </div>
      </section>

      {/* 結果テーブル */}
      <section className="card">
        <h2 className="card-title">
          水理計算書
          {result && <span className="card-title-sub">（{result.caseName}）</span>}
        </h2>
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
            <HydraulicResultTable points={points} result={result} />
            <div className="result-section" style={{ marginTop: 16 }}>
              <h3 className="result-section-title">集計</h3>
              <ResultRow label="最大流速" value={n(result.maxVelocity, 2)} unit="m/s"
                highlight={result.maxVelocity > 2.5} />
              <ResultRow label="最大設計内圧" value={n(result.maxDesignPressure, 2)} unit="MPa" highlight />
            </div>
          </>
        ) : (
          <div className="result-empty">
            {points.length === 0
              ? "Excelテンプレートの「測点データ」シートを読み込んでください。"
              : "静水位を入力してください。"}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── 水理計算書テーブル（成果品様式準拠） ──────────────────────────────────────

function HydraulicResultTable({
  points, result,
}: {
  points: MeasurementPoint[];
  result: LongitudinalHydraulicResult;
}) {
  return (
    <div className="hydraulic-table-scroll">
      <table className="hydraulic-table">
        <thead>
          <tr className="hydraulic-table-header1">
            <th rowSpan={3}>測点</th>
            <th rowSpan={3}>単距離<br/>Lh<br/><small>(m)</small></th>
            <th rowSpan={3}>地盤高<br/>GL<br/><small>(m)</small></th>
            <th rowSpan={3}>管中心高<br/>FH<br/><small>(m)</small></th>
            <th rowSpan={3}>管長<br/>SL<br/><small>(m)</small></th>
            <th rowSpan={3}>流量<br/>Q<br/><small>(m3/s)</small></th>
            <th rowSpan={3}>管径<br/>D<br/><small>(mm)</small></th>
            <th rowSpan={3}>流速係数<br/>CI</th>
            <th rowSpan={3}>動水勾配<br/><small>(permil)</small></th>
            <th rowSpan={3}>流速<br/>V<br/><small>(m/s)</small></th>
            <th rowSpan={3}>速度水頭<br/>hv<br/><small>(m)</small></th>
            <th rowSpan={3}>摩擦損失<br/>hf<br/><small>(m)</small></th>
            <th colSpan={5}>その他損失水頭 (m)</th>
            <th rowSpan={3}>全損失<br/>h<br/><small>(m)</small></th>
            <th rowSpan={3}>EL<br/><small>(m)</small></th>
            <th rowSpan={3}>動水位<br/>WLm<br/><small>(m)</small></th>
            <th rowSpan={3}>動水頭<br/>hm<br/><small>(m)</small></th>
            <th rowSpan={3}>静水圧<br/>Ps<br/><small>(MPa)</small></th>
            <th rowSpan={3}>水撃圧<br/>Pi<br/><small>(MPa)</small></th>
            <th rowSpan={3}>設計内圧<br/>Pp<br/><small>(MPa)</small></th>
          </tr>
          <tr className="hydraulic-table-header2">
            <th>湾曲<br/>fb</th>
            <th>バルブ<br/>fv</th>
            <th>直角分流<br/>f&#946;</th>
            <th>係数計<br/>&#931;f</th>
            <th>損失計<br/>&#931;hc<br/><small>(m)</small></th>
          </tr>
        </thead>
        <tbody>
          {points.map((pt, i) => {
            const r = result.pointResults[i];
            if (!r) return null;
            return (
              <tr key={pt.id}>
                <td className="hydraulic-td-id">{pt.id}</td>
                <td className="hydraulic-td-num">{n(pt.horizontalDistance, 3)}</td>
                <td className="hydraulic-td-num">{n(pt.groundLevel, 2)}</td>
                <td className="hydraulic-td-num">{n(pt.pipeCenterHeight, 3)}</td>
                <td className="hydraulic-td-num">{n(pt.pipeLength, 3)}</td>
                <td className="hydraulic-td-num">{n(pt.flowRate, 4)}</td>
                <td className="hydraulic-td-num">{(pt.diameter * 1000).toFixed(0)}</td>
                <td className="hydraulic-td-num">{n(pt.roughnessC, 0)}</td>
                <td className="hydraulic-td-num">{n(r.hydraulicGradient * 1000, 4)}</td>
                <td className="hydraulic-td-num">{n(r.velocity, 3)}</td>
                <td className="hydraulic-td-num">{n(r.velocityHead, 3)}</td>
                <td className="hydraulic-td-num">{n(r.frictionLoss, 3)}</td>
                <td className="hydraulic-td-num">{n(pt.bendLossCoeff, 3)}</td>
                <td className="hydraulic-td-num">{n(pt.valveLossCoeff, 3)}</td>
                <td className="hydraulic-td-num">{n(pt.branchLossCoeff, 3)}</td>
                <td className="hydraulic-td-num">{n(r.totalLossCoeff, 3)}</td>
                <td className="hydraulic-td-num">{n(r.minorLoss, 3)}</td>
                <td className="hydraulic-td-num hydraulic-td-hl">{n(r.totalLoss, 3)}</td>
                <td className="hydraulic-td-num hydraulic-td-computed">{n(r.energyLevel, 3)}</td>
                <td className="hydraulic-td-num hydraulic-td-computed">{n(r.hydraulicGradeLine, 3)}</td>
                <td className="hydraulic-td-num hydraulic-td-computed">{n(r.pressureHead, 3)}</td>
                <td className="hydraulic-td-num hydraulic-td-pressure">{n(r.staticPressure, 2)}</td>
                <td className="hydraulic-td-num hydraulic-td-pressure">{n(r.waterhammerPressure, 2)}</td>
                <td className="hydraulic-td-num hydraulic-td-design">{n(r.designPressure, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 共通コンポーネント ─────────────────────────────────────────────────────────

function InputField({
  label, unit, value, onChange, type = "number",
}: {
  label: string; unit: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="input-field">
      <label className="input-label">{label}</label>
      <div className="input-control">
        <input type={type} className="input" value={value}
          onChange={(e) => onChange(e.target.value)} step="any" />
        {unit && <span className="input-unit">{unit}</span>}
      </div>
    </div>
  );
}

function ResultRow({
  label, value, unit, highlight,
}: {
  label: string; value: string; unit?: string; highlight?: boolean;
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
