/**
 * ポンプシナリオ（急停止 / 起動）計算パネル
 * 出典: 土地改良設計基準パイプライン技術書 §8.4
 */

import { useState, useMemo, useEffect, useRef } from "react";
import {
  runMocPumpTrip,
  runMocPumpStart,
  calcWaveSpeed,
  headToMpa,
} from "@open-waterhammer/core";
import type { Pipe } from "@open-waterhammer/core";
import { DEMO_CASE_01_PIPE } from "@open-waterhammer/sample-data";
import { MocEnvelopeChart } from "./MocEnvelopeChart";
import { MocTimeChart } from "./MocTimeChart";

// ─── デモ初期値 ───────────────────────────────────────────────────────────────

const DEMO_PIPE: Pipe = DEMO_CASE_01_PIPE;
const DEMO_PUMP = { Q0_Ls: "75", H0: "50", Hs: "60" };

// ─── フォーム型 ───────────────────────────────────────────────────────────────

type ScenarioTab = "trip" | "start";

interface TripForm {
  innerDiameter: string;
  wallThickness: string;
  length: string;
  Q0_Ls: string;
  H0: string;
  Hs: string;
  shutdownTime: string;
  checkValve: boolean;
  nReaches: string;
}

interface StartForm {
  innerDiameter: string;
  wallThickness: string;
  length: string;
  Q_rated_Ls: string;
  H0: string;
  Hs: string;
  startupTime: string;
  staticHead: string;
  nReaches: string;
}

function defaultTripForm(): TripForm {
  return {
    innerDiameter: String(DEMO_PIPE.innerDiameter * 1000),
    wallThickness: String(DEMO_PIPE.wallThickness * 1000),
    length: String(DEMO_PIPE.length),
    Q0_Ls: DEMO_PUMP.Q0_Ls,
    H0: DEMO_PUMP.H0,
    Hs: DEMO_PUMP.Hs,
    shutdownTime: "1.0",
    checkValve: true,
    nReaches: "10",
  };
}

function defaultStartForm(): StartForm {
  return {
    innerDiameter: String(DEMO_PIPE.innerDiameter * 1000),
    wallThickness: String(DEMO_PIPE.wallThickness * 1000),
    length: String(DEMO_PIPE.length),
    Q_rated_Ls: DEMO_PUMP.Q0_Ls,
    H0: DEMO_PUMP.H0,
    Hs: DEMO_PUMP.Hs,
    startupTime: "3.0",
    staticHead: "0",
    nReaches: "10",
  };
}

function n(v: number, d = 2): string { return v.toFixed(d); }

// ─── フィールド行ヘルパー ─────────────────────────────────────────────────────

function Field({
  label, value, unit, onChange, min = "0",
}: {
  label: string; value: string; unit: string;
  onChange: (v: string) => void; min?: string;
}) {
  return (
    <div className="input-field">
      <span className="input-label">{label}</span>
      <div className="input-control">
        <input className="input" type="number" min={min} step="any"
          value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="input-unit">{unit}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

export function PumpCalculator() {
  const [tab, setTab] = useState<ScenarioTab>("trip");
  const [tripForm, setTripForm] = useState<TripForm>(defaultTripForm);
  const [startForm, setStartForm] = useState<StartForm>(defaultStartForm);
  const [snapIdx, setSnapIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(playing);
  playRef.current = playing;

  function updateTrip<K extends keyof TripForm>(k: K, v: TripForm[K]) {
    setTripForm((f) => ({ ...f, [k]: v }));
    setSnapIdx(0);
    setPlaying(false);
  }
  function updateStart<K extends keyof StartForm>(k: K, v: StartForm[K]) {
    setStartForm((f) => ({ ...f, [k]: v }));
    setSnapIdx(0);
    setPlaying(false);
  }

  // ── パース ────────────────────────────────────────────────────────────────
  const parsedTrip = useMemo(() => {
    const D = parseFloat(tripForm.innerDiameter) / 1000;
    const t = parseFloat(tripForm.wallThickness) / 1000;
    const L = parseFloat(tripForm.length);
    const Q0 = parseFloat(tripForm.Q0_Ls) / 1000;
    const H0 = parseFloat(tripForm.H0);
    const Hs = parseFloat(tripForm.Hs);
    const sd = parseFloat(tripForm.shutdownTime);
    const N = Math.max(4, Math.min(40, parseInt(tripForm.nReaches, 10) || 10));
    if ([D, t, L, Q0, H0, Hs, sd].some(isNaN) || D <= 0 || L <= 0 || Q0 <= 0 || H0 <= 0) return null;
    const pipe: Pipe = { ...DEMO_PIPE, innerDiameter: D, wallThickness: t, length: L };
    return { pipe, Q0, H0, Hs, sd, N, checkValve: tripForm.checkValve };
  }, [tripForm]);

  const parsedStart = useMemo(() => {
    const D = parseFloat(startForm.innerDiameter) / 1000;
    const t = parseFloat(startForm.wallThickness) / 1000;
    const L = parseFloat(startForm.length);
    const Qr = parseFloat(startForm.Q_rated_Ls) / 1000;
    const H0 = parseFloat(startForm.H0);
    const Hs = parseFloat(startForm.Hs);
    const st = parseFloat(startForm.startupTime);
    const sh = parseFloat(startForm.staticHead);
    const N = Math.max(4, Math.min(40, parseInt(startForm.nReaches, 10) || 10));
    if ([D, t, L, Qr, H0, Hs, st].some(isNaN) || D <= 0 || L <= 0 || Qr <= 0 || H0 <= 0) return null;
    const pipe: Pipe = { ...DEMO_PIPE, innerDiameter: D, wallThickness: t, length: L };
    return { pipe, Qr, H0, Hs, st, sh: isNaN(sh) ? 0 : sh, N };
  }, [startForm]);

  // ── MOC 実行 ─────────────────────────────────────────────────────────────
  const resultTrip = useMemo(() => {
    if (!parsedTrip) return null;
    const { pipe, Q0, H0, Hs, sd, N, checkValve } = parsedTrip;
    return runMocPumpTrip({
      pipe,
      waveSpeed: calcWaveSpeed(pipe),
      Q0,
      pumpHead: H0,
      Hs,
      shutdownTime: sd,
      checkValve,
      nReaches: N,
    });
  }, [parsedTrip]);

  const resultStart = useMemo(() => {
    if (!parsedStart) return null;
    const { pipe, Qr, H0, Hs, st, sh, N } = parsedStart;
    return runMocPumpStart({
      pipe,
      waveSpeed: calcWaveSpeed(pipe),
      Q_rated: Qr,
      pumpHead: H0,
      Hs,
      startupTime: st,
      staticHead: sh,
      nReaches: N,
    });
  }, [parsedStart]);

  const result = tab === "trip" ? resultTrip : resultStart;
  const pipe0 = result?.pipes["pipe_0"] ?? null;
  const pumpNodeH = result?.nodes["pump_node"] ?? null;
  const downstreamH = result?.nodes["dead_end_node"] ?? null;
  const H_steady = pipe0?.H_steady ?? [];

  const pumpHSeries = pumpNodeH?.H ?? [];
  const downHSeries = downstreamH?.H ?? [];
  const Hmax_pump = pumpHSeries.length ? Math.max(...pumpHSeries.map((p) => p.H)) : 0;
  const Hmin_pump = pumpHSeries.length ? Math.min(...pumpHSeries.map((p) => p.H)) : 0;
  const Hmax_dn = downHSeries.length ? Math.max(...downHSeries.map((p) => p.H)) : 0;
  const Hmin_dn = downHSeries.length ? Math.min(...downHSeries.map((p) => p.H)) : 0;

  const currentSnap = pipe0?.snapshots[snapIdx] ?? null;
  const totalSnaps = pipe0?.snapshots.length ?? 0;

  // タブ切替時にスクロールリセット
  useEffect(() => {
    setSnapIdx(0);
    setPlaying(false);
  }, [tab]);

  // ── アニメーション ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !pipe0) return;
    const id = setInterval(() => {
      setSnapIdx((prev) => {
        if (prev >= pipe0.snapshots.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 40); // 25 fps
    return () => clearInterval(id);
  }, [playing, pipe0]);

  function handlePlayPause() {
    if (!pipe0) return;
    if (snapIdx >= pipe0.snapshots.length - 1) {
      setSnapIdx(0);
    }
    setPlaying((p) => !p);
  }

  // ─────────────────────────────────────────────────────────────────────────

  const tripInputs = (
    <div>
      <div className="input-group">
        <p className="input-group-title">管路諸元</p>
        <div className="input-grid">
          <Field label="内径 D" unit="mm" value={tripForm.innerDiameter} onChange={(v) => updateTrip("innerDiameter", v)} />
          <Field label="管厚 t" unit="mm" value={tripForm.wallThickness} onChange={(v) => updateTrip("wallThickness", v)} />
          <Field label="延長 L" unit="m" value={tripForm.length} onChange={(v) => updateTrip("length", v)} />
        </div>
      </div>
      <div className="input-group">
        <p className="input-group-title">ポンプ諸元</p>
        <div className="input-grid">
          <Field label="定格流量 Q₀" unit="L/s" value={tripForm.Q0_Ls} onChange={(v) => updateTrip("Q0_Ls", v)} />
          <Field label="定格揚程 H₀" unit="m" value={tripForm.H0} onChange={(v) => updateTrip("H0", v)} />
          <Field label="締切水頭 Hs" unit="m" value={tripForm.Hs} onChange={(v) => updateTrip("Hs", v)} />
        </div>
      </div>
      <div className="input-group">
        <p className="input-group-title">操作・設定</p>
        <div className="input-grid">
          <Field label="停止時間 t_d" unit="s" value={tripForm.shutdownTime} onChange={(v) => updateTrip("shutdownTime", v)} />
          <Field label="分割数 N" unit="区間" value={tripForm.nReaches} min="4" onChange={(v) => updateTrip("nReaches", v)} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: "0.9rem" }}>
          <input type="checkbox" checked={tripForm.checkValve}
            onChange={(e) => updateTrip("checkValve", e.target.checked)} />
          逆止め弁あり（逆流遮断）
        </label>
      </div>
    </div>
  );

  const startInputs = (
    <div>
      <div className="input-group">
        <p className="input-group-title">管路諸元</p>
        <div className="input-grid">
          <Field label="内径 D" unit="mm" value={startForm.innerDiameter} onChange={(v) => updateStart("innerDiameter", v)} />
          <Field label="管厚 t" unit="mm" value={startForm.wallThickness} onChange={(v) => updateStart("wallThickness", v)} />
          <Field label="延長 L" unit="m" value={startForm.length} onChange={(v) => updateStart("length", v)} />
        </div>
      </div>
      <div className="input-group">
        <p className="input-group-title">ポンプ諸元</p>
        <div className="input-grid">
          <Field label="定格流量 Q" unit="L/s" value={startForm.Q_rated_Ls} onChange={(v) => updateStart("Q_rated_Ls", v)} />
          <Field label="定格揚程 H₀" unit="m" value={startForm.H0} onChange={(v) => updateStart("H0", v)} />
          <Field label="締切水頭 Hs" unit="m" value={startForm.Hs} onChange={(v) => updateStart("Hs", v)} />
        </div>
      </div>
      <div className="input-group">
        <p className="input-group-title">操作・設定</p>
        <div className="input-grid">
          <Field label="起動時間 t_s" unit="s" value={startForm.startupTime} onChange={(v) => updateStart("startupTime", v)} />
          <Field label="起動前静水頭" unit="m" value={startForm.staticHead} min="-999" onChange={(v) => updateStart("staticHead", v)} />
          <Field label="分割数 N" unit="区間" value={startForm.nReaches} min="4" onChange={(v) => updateStart("nReaches", v)} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="card">
      <h2 className="card-title">ポンプシナリオ MOC 非定常計算（§8.4）</h2>

      {/* シナリオタブ */}
      <div className="demo-tabs" style={{ marginBottom: 16 }}>
        <button className={`demo-tab${tab === "trip" ? " demo-tab--active" : ""}`}
          onClick={() => setTab("trip")}>
          ポンプ急停止
        </button>
        <button className={`demo-tab${tab === "start" ? " demo-tab--active" : ""}`}
          onClick={() => setTab("start")}>
          ポンプ起動
        </button>
      </div>

      <div className="calculator-body">
        {/* 左: 入力 */}
        {tab === "trip" ? tripInputs : startInputs}

        {/* 右: 結果サマリー */}
        <div>
          {result && pipe0 ? (
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
              </div>

              <div className="result-section">
                <p className="result-section-title">ポンプ端水頭</p>
                <div className="result-row result-row--highlight">
                  <span className="result-label">Hmax</span>
                  <span className="result-value">{n(Hmax_pump, 1)}<span className="result-unit"> m ({headToMpa(Hmax_pump).toFixed(4)} MPa)</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">Hmin</span>
                  <span className="result-value">{n(Hmin_pump, 1)}<span className="result-unit"> m ({headToMpa(Hmin_pump).toFixed(4)} MPa)</span></span>
                </div>
              </div>

              <div className="result-section">
                <p className="result-section-title">末端水頭</p>
                <div className="result-row result-row--highlight">
                  <span className="result-label">Hmax</span>
                  <span className="result-value">{n(Hmax_dn, 1)}<span className="result-unit"> m</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">Hmin</span>
                  <span className="result-value">{n(Hmin_dn, 1)}<span className="result-unit"> m</span></span>
                </div>
                {Hmin_dn < 0 && (
                  <div className="result-row" style={{ color: "#e53e3e", fontSize: "0.85rem", fontWeight: 600 }}>
                    負圧発生 — 水柱分離に注意
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="result-empty">有効な入力値を確認してください</p>
          )}
        </div>
      </div>

      {/* グラフエリア */}
      {result && pipe0 && H_steady.length > 0 && (() => {
        const pipeLength = tab === "trip"
          ? (parsedTrip?.pipe.length ?? 500)
          : (parsedStart?.pipe.length ?? 500);
        const H0ref = tab === "trip" ? (parsedTrip?.H0 ?? 0) : (parsedStart?.H0 ?? 0);
        const HR = pumpHSeries[0]?.H ?? 0;

        return (
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>

            {/* 包絡線図 + アニメーション */}
            <div>
              <p className="result-section-title" style={{ marginBottom: 8 }}>
                管路縦断圧力包絡線図
              </p>

              {/* スクロール + 再生コントロール */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <button
                  className={`btn ${playing ? "btn--primary" : "btn--secondary"}`}
                  style={{ padding: "4px 14px", fontSize: "0.82rem", minWidth: 64 }}
                  onClick={handlePlayPause}
                >
                  {playing ? "⏸ 停止" : "▶ 再生"}
                </button>
                <input
                  type="range" min={0} max={totalSnaps - 1} step={1}
                  value={snapIdx}
                  onChange={(e) => { setPlaying(false); setSnapIdx(Number(e.target.value)); }}
                  style={{ flex: 1 }}
                />
                <span className="result-value" style={{ fontSize: "0.88rem", minWidth: 64 }}>
                  t = {currentSnap ? currentSnap.t.toFixed(3) : "0.000"} s
                </span>
                <button
                  className="btn btn--secondary"
                  style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                  onClick={() => { setPlaying(false); setSnapIdx(0); }}
                >
                  初期
                </button>
              </div>

              <MocEnvelopeChart
                pipeLength={pipeLength}
                Hmax={pipe0.Hmax}
                Hmin={pipe0.Hmin}
                H_steady={H_steady}
                snapshot={currentSnap?.H}
                snapshotTime={currentSnap?.t}
              />
              <p className="result-standard" style={{ marginTop: 6 }}>
                赤線: Hmax包絡　緑線: Hmin包絡　灰破線: 初期水頭　青線: H(x,t)スナップショット
              </p>
            </div>

            {/* ポンプ端 H(t) 時系列 */}
            <div>
              <p className="result-section-title" style={{ marginBottom: 8 }}>
                ポンプ端水頭 H(t) 時系列
              </p>
              <MocTimeChart
                downstreamH={pumpHSeries}
                H0={H0ref}
                HR={HR}
                vibrationPeriod={pipe0.vibrationPeriod}
              />
            </div>
          </div>
        );
      })()}

      <div className="result-footer" style={{ marginTop: 16 }}>
        <p className="result-standard">
          出典: 土地改良設計基準パイプライン技術書 §8.4（特性曲線法）／
          {tab === "trip"
            ? "ポンプ急停止・放物線型 H-Q 特性・線形回転数減衰"
            : "ポンプ起動・放物線型 H-Q 特性・線形回転数上昇"}
        </p>
      </div>
    </div>
  );
}
