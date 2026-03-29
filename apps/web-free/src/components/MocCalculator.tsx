/**
 * 特性曲線法（MOC）計算パネル
 * 出典: 土地改良設計基準パイプライン技術書 §8.4
 */

import { useState, useMemo } from "react";
import {
  runMocSinglePipe,
  calcWaveSpeed,
  joukowsky,
  headToMpa,
} from "@open-waterhammer/core";
import type { Pipe } from "@open-waterhammer/core";
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

export function MocCalculator() {
  const [demoId, setDemoId] = useState<"01" | "02">("01");
  const [form, setForm] = useState<FormState>(
    () => demoToForm(DEMO_CASE_01_PIPE, DEMO_CASE_01_CASE, DEMO_CASE_01_CLOSE_TIME),
  );
  const [snapIdx, setSnapIdx] = useState(0);

  function selectDemo(id: "01" | "02") {
    const d = DEMO_CASES.find((c) => c.id === id)!;
    setDemoId(id);
    setForm(demoToForm(d.pipe, d.cas, d.closeTime));
    setSnapIdx(0);
  }

  function updateField(key: keyof FormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
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

    const demo = DEMO_CASES.find((d) => d.id === demoId)!;
    const pipe: Pipe = {
      ...demo.pipe,
      innerDiameter: isNaN(D) ? demo.pipe.innerDiameter : D,
      wallThickness: isNaN(t) ? demo.pipe.wallThickness : t,
      length: isNaN(L) ? demo.pipe.length : L,
    };

    if (isNaN(V0) || isNaN(H0) || isNaN(tv) || V0 < 0 || H0 <= 0 || tv < 0) return null;
    return { pipe, V0, H0, tv, N };
  }, [form, demoId]);

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
      <h2 className="card-title">特性曲線法（MOC）非定常水撃圧計算（§8.4）</h2>

      {/* デモ選択 */}
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

      <div className="calculator-body">
        {/* ── 左: 入力 ── */}
        <div>
          <div className="input-group">
            <p className="input-group-title">管路諸元</p>
            <div className="input-grid">
              {(
                [
                  { key: "innerDiameter", label: "内径 D", unit: "mm" },
                  { key: "wallThickness", label: "管厚 t", unit: "mm" },
                  { key: "length",        label: "延長 L", unit: "m" },
                ] as { key: keyof FormState; label: string; unit: string }[]
              ).map(({ key, label, unit }) => (
                <div className="input-field" key={key}>
                  <span className="input-label">{label}</span>
                  <div className="input-control">
                    <input className="input" type="number" min="0" step="any"
                      value={form[key]} onChange={(e) => updateField(key, e.target.value)} />
                    <span className="input-unit">{unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="input-group">
            <p className="input-group-title">初期条件・操作</p>
            <div className="input-grid">
              {(
                [
                  { key: "initialVelocity", label: "初期流速 V₀", unit: "m/s" },
                  { key: "initialHead",     label: "初期水頭 H₀", unit: "m" },
                  { key: "closeTime",       label: "閉そく時間 tν", unit: "s" },
                ] as { key: keyof FormState; label: string; unit: string }[]
              ).map(({ key, label, unit }) => (
                <div className="input-field" key={key}>
                  <span className="input-label">{label}</span>
                  <div className="input-control">
                    <input className="input" type="number" min="0" step="any"
                      value={form[key]} onChange={(e) => updateField(key, e.target.value)} />
                    <span className="input-unit">{unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="input-group">
            <p className="input-group-title">計算設定</p>
            <div className="input-grid">
              <div className="input-field">
                <span className="input-label">分割数 N（4〜40）</span>
                <div className="input-control">
                  <input className="input" type="number" min="4" max="40" step="1"
                    value={form.nReaches} onChange={(e) => updateField("nReaches", e.target.value)} />
                  <span className="input-unit">区間</span>
                </div>
              </div>
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
                    <span className="result-label">MOC/Joukowsky 比</span>
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
            <p className="result-section-title" style={{ marginBottom: 8 }}>
              管路縦断圧力包絡線図
            </p>

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

            <MocEnvelopeChart
              pipeLength={parsed?.pipe.length ?? 500}
              Hmax={pipe0.Hmax}
              Hmin={pipe0.Hmin}
              H_steady={H_steady}
              snapshot={currentSnap?.H}
              snapshotTime={currentSnap?.t}
            />
            <p className="result-standard" style={{ marginTop: 6 }}>
              赤線: Hmax包絡　緑線: Hmin包絡　灰破線: 定常状態　青線: スクロール時刻の水頭プロファイル H(x,t)
            </p>
          </div>

          {/* ── 下流端 H(t) 時系列チャート ── */}
          <div>
            <p className="result-section-title" style={{ marginBottom: 8 }}>
              下流端（バルブ）水頭 H(t) 時系列
            </p>
            <MocTimeChart
              downstreamH={downstreamHSeries}
              H0={parsed!.H0}
              HR={HR}
              vibrationPeriod={pipe0.vibrationPeriod}
            />
          </div>
        </div>
      )}

      <div className="result-footer" style={{ marginTop: 16 }}>
        <p className="result-standard">
          出典: 土地改良設計基準パイプライン技術書 §8.4（特性曲線法）／
          単一管路・定水頭上流境界・線形バルブ閉操作・準定常摩擦（Darcy-Weisbach）
        </p>
      </div>
    </div>
  );
}
