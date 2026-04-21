/**
 * 特性曲線法（MOC）計算パネル
 * 出典: 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8.4
 */

import { useState, useMemo, useEffect } from "react";
import {
  runMocSinglePipe,
  calcWaveSpeed,
  joukowsky,
  headToMpa,
} from "@open-waterhammer/core";
import type { Pipe, MocResult, LongitudinalHydraulicResult } from "@open-waterhammer/core";
import type { WorkbookData } from "@open-waterhammer/excel-io";
import {
  DEMO_CASE_01_PIPE,
  DEMO_CASE_01_CASE,
  DEMO_CASE_01_CLOSE_TIME,
  DEMO_CASE_02_PIPE,
  DEMO_CASE_02_CASE,
  DEMO_CASE_02_CLOSE_TIME,
} from "@open-waterhammer/sample-data";
import { MocTimeChart } from "./MocTimeChart";
import { MocEnvelopeChart } from "./MocEnvelopeChart";
import { ChartFrame } from "./ChartFrame";
import { RefTooltip } from "./RefTooltip";
import { InputField } from "./InputField";
import { downloadCsv } from "../utils/csv";

// ─── デモケース ───────────────────────────────────────────────────────────────

const DEMO_CASES = [
  {
    id: "01",
    label: "デモ01: バルブ急閉そく",
    pipe: DEMO_CASE_01_PIPE,
    cas: DEMO_CASE_01_CASE,
    closeTime: DEMO_CASE_01_CLOSE_TIME,
  },
  {
    id: "02",
    label: "デモ02: バルブ緩閉そく",
    pipe: DEMO_CASE_02_PIPE,
    cas: DEMO_CASE_02_CASE,
    closeTime: DEMO_CASE_02_CLOSE_TIME,
  },
] as const;

// ─── フォーム状態 ─────────────────────────────────────────────────────────────

interface FormState {
  innerDiameter: string;
  wallThickness: string;
  length: string;
  initialVelocity: string;
  initialHead: string;
  closeTime: string;
  nReaches: string;
}

function demoToForm(
  pipe: Pipe,
  cas: { initialVelocity: number; initialHead: number },
  closeTime: number,
): FormState {
  return {
    innerDiameter: String(pipe.innerDiameter * 1000),
    wallThickness: String(pipe.wallThickness * 1000),
    length: String(pipe.length),
    initialVelocity: String(cas.initialVelocity),
    initialHead: String(cas.initialHead),
    closeTime: String(closeTime),
    nReaches: "10",
  };
}

function n(v: number, d = 2): string { return v.toFixed(d); }

// ─── コンポーネント ───────────────────────────────────────────────────────────

export interface MocCalculatorProps {
  excelData?: WorkbookData | null;
  /** 計算結果を親に通知（セッション保存用） */
  onResult?: (result: MocResult | null) => void;
  /** Step5（定常計算）の結果 — 「定常結果から引用」ボタンで V₀/H₀ に反映する */
  steadyResult?: LongitudinalHydraulicResult | null;
}

export function MocCalculator({ excelData, onResult, steadyResult }: MocCalculatorProps) {
  const excelPipes = excelData?.pipes ?? [];
  const excelCases = excelData?.cases ?? [];
  const hasExcel = excelPipes.length > 0;

  const [demoId, setDemoId] = useState<"01" | "02">("01");
  const [form, setForm] = useState<FormState>(
    () => demoToForm(DEMO_CASE_01_PIPE, DEMO_CASE_01_CASE, DEMO_CASE_01_CLOSE_TIME),
  );
  const [snapIdx, setSnapIdx] = useState(0);
  const [inputSource, setInputSource] = useState<"demo" | "excel">("demo");
  const [selectedExcelCase, setSelectedExcelCase] = useState<string>("");

  // Excel データが新しく読み込まれたら自動切替
  const [lastExcelLen, setLastExcelLen] = useState(0);
  if (excelPipes.length > 0 && excelPipes.length !== lastExcelLen) {
    setLastExcelLen(excelPipes.length);
    setInputSource("excel");
    const pipe = excelPipes[0]!;
    const cas = excelCases[0];
    setSelectedExcelCase(cas?.id ?? "");
    setForm({
      innerDiameter: String(pipe.innerDiameter * 1000),
      wallThickness: String(pipe.wallThickness * 1000),
      length: String(pipe.length),
      initialVelocity: cas ? String(cas.initialVelocity) : "1.0",
      initialHead: cas ? String(cas.initialHead) : "30",
      closeTime: "1.0",
      nReaches: "10",
    });
    setSnapIdx(0);
  }

  function selectDemo(id: "01" | "02") {
    const d = DEMO_CASES.find((c) => c.id === id)!;
    setDemoId(id);
    setInputSource("demo");
    setForm(demoToForm(d.pipe, d.cas, d.closeTime));
    setSnapIdx(0);
  }

  function selectExcelCase(caseId: string) {
    setSelectedExcelCase(caseId);
    const cas = excelCases.find((c) => c.id === caseId);
    if (cas) {
      setForm((f) => ({
        ...f,
        initialVelocity: String(cas.initialVelocity),
        initialHead: String(cas.initialHead),
      }));
    }
    setSnapIdx(0);
  }

  function updateField(key: keyof FormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
    setSnapIdx(0);
  }

  // ─── Step5（定常計算）結果の引用 ─────────────────────────────────────────
  // 最大流速を V₀、下流端の動水頭 hm を H₀ として採用
  function importFromSteady() {
    if (!steadyResult) return;
    const V = steadyResult.maxVelocity;
    const lastPoint = steadyResult.pointResults[steadyResult.pointResults.length - 1];
    const H = lastPoint ? lastPoint.pressureHead : null;
    setForm((f) => ({
      ...f,
      initialVelocity: V > 0 ? V.toFixed(3) : f.initialVelocity,
      initialHead: H && H > 0 ? H.toFixed(2) : f.initialHead,
    }));
    setSnapIdx(0);
  }

  // ── 入力値パース ──────────────────────────────────────────────────────────
  const parsed = useMemo(() => {
    const D = parseFloat(form.innerDiameter) / 1000;
    const t = parseFloat(form.wallThickness) / 1000;
    const L = parseFloat(form.length);
    const V0 = parseFloat(form.initialVelocity);
    const H0 = parseFloat(form.initialHead);
    const tv = parseFloat(form.closeTime);
    const N = Math.max(4, Math.min(40, parseInt(form.nReaches, 10) || 10));

    let basePipe: Pipe;
    if (inputSource === "excel" && excelPipes.length > 0) {
      basePipe = excelPipes[0]!;
    } else {
      basePipe = DEMO_CASES.find((d) => d.id === demoId)!.pipe;
    }

    const pipe: Pipe = {
      ...basePipe,
      innerDiameter: isNaN(D) ? basePipe.innerDiameter : D,
      wallThickness: isNaN(t) ? basePipe.wallThickness : t,
      length: isNaN(L) ? basePipe.length : L,
    };

    if (isNaN(V0) || isNaN(H0) || isNaN(tv) || V0 < 0 || H0 <= 0 || tv < 0) return null;
    return { pipe, V0, H0, tv, N };
  }, [form, demoId, inputSource, excelPipes]);

  // ── MOC 実行 ──────────────────────────────────────────────────────────────
  const result = useMemo(() => {
    if (!parsed) return null;
    const { pipe, V0, H0, tv, N } = parsed;
    const a = calcWaveSpeed(pipe);
    return runMocSinglePipe({
      pipe,
      waveSpeed: a,
      initialVelocity: V0,
      initialDownstreamHead: H0,
      closeTime: tv,
      nReaches: N,
    });
  }, [parsed]);

  // 親へ通知（セッション保存用）
  useEffect(() => {
    onResult?.(result);
  }, [result, onResult]);

  // ── 単一管路結果の取り出し ────────────────────────────────────────────────
  const pipe0 = result?.pipes["pipe_0"] ?? null;
  const upstreamNodeH   = result?.nodes["upstream"]   ?? null;
  const downstreamNodeH = result?.nodes["downstream"] ?? null;

  // ── 定常状態プロファイル ──────────────────────────────────────────────────
  const H_steady = pipe0?.H_steady ?? [];

  // ── 下流端サマリー ─────────────────────────────────────────────────────────
  const downstreamHSeries = downstreamNodeH?.H ?? [];
  const Hmax_downstream = downstreamHSeries.length ? Math.max(...downstreamHSeries.map((p) => p.H)) : 0;
  const Hmin_downstream = downstreamHSeries.length ? Math.min(...downstreamHSeries.map((p) => p.H)) : 0;
  const HR = upstreamNodeH?.H[0]?.H ?? 0;

  // ── ジューコフスキー参照値 ─────────────────────────────────────────────────
  const joukowskyRef = useMemo(() => {
    if (!parsed || !pipe0) return null;
    const dH = joukowsky(pipe0.waveSpeed, -parsed.V0);
    return { dH, mpa: headToMpa(dH) };
  }, [parsed, pipe0]);

  // ── スクロール対象スナップショット ─────────────────────────────────────────
  const currentSnap = pipe0?.snapshots[snapIdx] ?? null;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="card">
      <h2 className="card-title">水撃圧 数値解析（§8.4）</h2>

      {/* ソース切替 */}
      <div className="source-tabs" style={{ marginBottom: 12 }}>
        <button
          className={`source-tab${inputSource === "demo" ? " source-tab--active" : ""}`}
          onClick={() => { setInputSource("demo"); selectDemo(demoId); }}
        >デモデータ</button>
        <button
          className={`source-tab${inputSource === "excel" ? " source-tab--active" : ""}`}
          onClick={() => setInputSource("excel")}
          disabled={!hasExcel}
        >Excel 読み込みデータ {hasExcel ? `(${excelCases.length}件)` : ""}</button>
      </div>

      {inputSource === "demo" && (
        <div className="demo-tabs" style={{ marginBottom: 16 }}>
          {DEMO_CASES.map((d) => (
            <button
              key={d.id}
              className={`demo-tab${demoId === d.id ? " demo-tab--active" : ""}`}
              onClick={() => selectDemo(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {inputSource === "excel" && hasExcel && excelCases.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label className="input-label">ケース選択</label>
          <select className="input" value={selectedExcelCase}
            onChange={(e) => selectExcelCase(e.target.value)}>
            {excelCases.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="calculator-body">
        {/* ── 左: 入力 ── */}
        <div>
          <div className="input-group">
            <p className="input-group-title">管路諸元</p>
            <div className="input-grid">
              <InputField label="内径 D" unit="mm" required min={10} max={5000}
                value={form.innerDiameter} onChange={(v) => updateField("innerDiameter", v)} />
              <InputField label="管厚 t" unit="mm" required min={0.5} max={200}
                value={form.wallThickness} onChange={(v) => updateField("wallThickness", v)} />
              <InputField label="延長 L" unit="m" required min={1} max={100000}
                value={form.length} onChange={(v) => updateField("length", v)} />
            </div>
          </div>

          <div className="input-group">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <p className="input-group-title" style={{ margin: 0 }}>初期条件・操作</p>
              {steadyResult && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                  onClick={importFromSteady}
                  title={`最大流速 ${steadyResult.maxVelocity.toFixed(3)} m/s、下流端動水頭を V₀/H₀ にコピーします`}
                >
                  ↑ 定常計算の結果から引用
                </button>
              )}
            </div>
            <div className="input-grid">
              <InputField label="初期流速 V₀" unit="m/s" required min={0} max={20}
                warnMax={2.5} warnMessage="設計指針の推奨上限 2.5 m/s を超えています"
                value={form.initialVelocity} onChange={(v) => updateField("initialVelocity", v)} />
              <InputField label="初期水頭 H₀" unit="m" required min={0.1} max={1000}
                value={form.initialHead} onChange={(v) => updateField("initialHead", v)} />
              <InputField label="閉そく時間 tν" unit="s" required min={0} max={1000}
                value={form.closeTime} onChange={(v) => updateField("closeTime", v)} />
            </div>
          </div>

          <div className="input-group">
            <p className="input-group-title">計算設定</p>
            <div className="input-grid">
              <InputField label="分割数 N（4〜40）" unit="区間" required min={4} max={40} step="1"
                value={form.nReaches} onChange={(v) => updateField("nReaches", v)} />
            </div>
            <p className="demo-note" style={{ marginTop: 6 }}>
              Δt = Δx/a（クーラン条件）。シミュレーション時間: 3×T₀
            </p>
          </div>
        </div>

        {/* ── 右: 結果サマリー ── */}
        <div>
          {result && pipe0 && parsed ? (
            <>
              <div className="result-section">
                <p className="result-section-title">計算条件</p>
                <div className="result-row">
                  <span className="result-label">波速 a</span>
                  <span className="result-value">{n(pipe0.waveSpeed, 1)}<span className="result-unit"> m/s</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">振動周期 T₀</span>
                  <span className="result-value">{n(pipe0.vibrationPeriod, 3)}<span className="result-unit"> s</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">上流端水頭 HR</span>
                  <span className="result-value">{n(HR, 2)}<span className="result-unit"> m</span></span>
                </div>
              </div>

              <div className="result-section">
                <p className="result-section-title">下流端（バルブ）水頭</p>
                <div className="result-row result-row--highlight">
                  <span className="result-label">最大水頭 Hmax</span>
                  <span className="result-value">{n(Hmax_downstream, 1)}<span className="result-unit"> m</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">最小水頭 Hmin</span>
                  <span className="result-value">{n(Hmin_downstream, 1)}<span className="result-unit"> m</span></span>
                </div>
                <div className="result-row result-row--highlight">
                  <span className="result-label">ΔHmax（水撃圧）</span>
                  <span className="result-value">
                    {n(Hmax_downstream - parsed.H0, 1)}<span className="result-unit"> m</span>
                    <span className="result-unit" style={{ marginLeft: 8 }}>
                      ({headToMpa(Hmax_downstream - parsed.H0).toFixed(4)} MPa)
                    </span>
                  </span>
                </div>
              </div>

              {joukowskyRef && (
                <div className="result-section">
                  <p className="result-section-title">参考: ジューコフスキー（急閉上限）</p>
                  <div className="result-row">
                    <span className="result-label">ΔH</span>
                    <span className="result-value">
                      {n(joukowskyRef.dH, 1)}<span className="result-unit"> m ({joukowskyRef.mpa.toFixed(4)} MPa)</span>
                    </span>
                  </div>
                  <div className="result-row">
                    <span className="result-label">数値解析/Joukowsky 比</span>
                    <span className="result-value">
                      {((Hmax_downstream - parsed.H0) / joukowskyRef.dH * 100).toFixed(1)}<span className="result-unit"> %</span>
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="result-empty">有効な入力値を確認してください</p>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* グラフエリア                                                       */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      {result && pipe0 && H_steady.length > 0 && (
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── 管路縦断圧力包絡線図 ── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <p className="result-section-title" style={{ margin: 0 }}>
                管路縦断圧力包絡線図
              </p>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                onClick={() => {
                  const rows: (string | number)[][] = [["x(m)", "Hmax(m)", "Hmin(m)", "H_steady(m)"]];
                  const L = parsed?.pipe.length ?? 0;
                  const N = pipe0.Hmax.length;
                  for (let i = 0; i < N; i++) {
                    const x = (i / Math.max(N - 1, 1)) * L;
                    rows.push([x, pipe0.Hmax[i] ?? 0, pipe0.Hmin[i] ?? 0, H_steady[i] ?? 0]);
                  }
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`moc-envelope-${stamp}.csv`, rows);
                }}
              >
                ↓ CSV 出力
              </button>
            </div>

            {/* 時刻スクロールバー */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <span className="input-label" style={{ whiteSpace: "nowrap" }}>時刻スクロール</span>
              <input
                type="range"
                min={0}
                max={pipe0.snapshots.length - 1}
                step={1}
                value={snapIdx}
                onChange={(e) => setSnapIdx(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="result-value" style={{ fontSize: "0.88rem", minWidth: 64 }}>
                t = {currentSnap ? currentSnap.t.toFixed(3) : "0.000"} s
              </span>
              <button
                className="btn btn--secondary"
                style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                onClick={() => setSnapIdx(0)}
              >
                初期
              </button>
            </div>

            <ChartFrame filename="moc_envelope">
              <MocEnvelopeChart
                pipeLength={parsed?.pipe.length ?? 500}
                Hmax={pipe0.Hmax}
                Hmin={pipe0.Hmin}
                H_steady={H_steady}
                snapshot={currentSnap?.H}
                snapshotTime={currentSnap?.t}
              />
            </ChartFrame>
            <p className="result-standard" style={{ marginTop: 6 }}>
              赤線: Hmax包絡　緑線: Hmin包絡　灰破線: 定常状態　青線: スクロール時刻の水頭プロファイル H(x,t)
            </p>
          </div>

          {/* ── 下流端 H(t) 時系列チャート ── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <p className="result-section-title" style={{ margin: 0 }}>
                下流端（バルブ）水頭 H(t) 時系列
              </p>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                onClick={() => {
                  const rows: (string | number)[][] = [["t(s)", "H(m)"]];
                  downstreamHSeries.forEach((p) => rows.push([p.t, p.H]));
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`moc-downstream-${stamp}.csv`, rows);
                }}
              >
                ↓ CSV 出力
              </button>
            </div>
            <ChartFrame filename="moc_time_history">
              <MocTimeChart
                downstreamH={downstreamHSeries}
                H0={parsed!.H0}
                HR={HR}
                vibrationPeriod={pipe0.vibrationPeriod}
              />
            </ChartFrame>
          </div>
        </div>
      )}

      <div className="result-footer" style={{ marginTop: 16 }}>
        <p className="result-standard">
          出典: <RefTooltip topicId="moc">技術書 §8.4（特性曲線法）</RefTooltip>　／
          単一管路・定水頭上流境界・線形バルブ閉操作・準定常摩擦（Darcy-Weisbach）
        </p>
      </div>
    </div>
  );
}
