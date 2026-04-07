/**
 * 水撃圧防護設備計算パネル（比較表示）
 * エアチャンバ / サージタンク / 吸気弁 / 減圧バルブ
 * 出典: 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8.3 / §8.5
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  runMoc,
  runMocPumpTrip,
  calcWaveSpeed,
  headToMpa,
} from "@open-waterhammer/core";
import type { Pipe, MocResult } from "@open-waterhammer/core";
import type { WorkbookData } from "@open-waterhammer/excel-io";
import { DEMO_CASE_01_PIPE } from "@open-waterhammer/sample-data";
import { MocEnvelopeChart } from "./MocEnvelopeChart";
import { MocTimeChart } from "./MocTimeChart";

const DEMO_PIPE: Pipe = DEMO_CASE_01_PIPE;

type DeviceTab = "air_chamber" | "surge_tank" | "air_release_valve" | "prv";

// ─── 共通ポンプ・管路フォーム ──────────────────────────────────────────────────

interface BaseForm {
  innerDiameter: string; wallThickness: string; length: string;
  Q0_Ls: string; H0: string; Hs: string;
  shutdownTime: string; nReaches: string;
}

// ─── 各設備固有フォーム ────────────────────────────────────────────────────────

interface AirChamberForm {
  V_air0: string; H_air0: string; polytropicIndex: string;
}
interface SurgeTankForm {
  tankArea: string; initialLevel: string; datum: string;
}
interface AirValveForm {
  atmosphericHead: string;
}
interface PRVForm {
  setHead: string;
}

function defaultBase(): BaseForm {
  return {
    innerDiameter: String(DEMO_PIPE.innerDiameter * 1000),
    wallThickness: String(DEMO_PIPE.wallThickness * 1000),
    length: String(DEMO_PIPE.length),
    Q0_Ls: "75", H0: "50", Hs: "60",
    shutdownTime: "1.0", nReaches: "10",
  };
}

function n(v: number, d = 2): string { return v.toFixed(d); }

function Field({ label, value, unit, onChange, min = "0" }: {
  label: string; value: string; unit: string; onChange: (v: string) => void; min?: string;
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

// ─── 設備説明 ────────────────────────────────────────────────────────────────

const DEVICE_INFO: Record<DeviceTab, { label: string; desc: string; basis: string }> = {
  air_chamber: {
    label: "エアチャンバ（圧力タンク）",
    desc: "密閉タンク内の圧縮空気が負圧発生時に管内へ水を供給し、圧力低下を抑制する。",
    basis: "技術書 §8.3 表-8.3.1「圧力タンク」負圧防止対策",
  },
  surge_tank: {
    label: "サージタンク（調圧水槽）",
    desc: "管路途中に設けた開放型水槽が圧力変動を吸収・緩和する（剛体理論 §8.5）。",
    basis: "技術書 §8.5 剛体理論による非定常流況解析",
  },
  air_release_valve: {
    label: "吸気弁（真空破壊弁）",
    desc: "管内圧力が大気圧以下になると弁が開き外気を吸入して負圧を防止する。",
    basis: "技術書 §8.3 負圧防止対策「吸気弁」",
  },
  prv: {
    label: "減圧バルブ（PRV）",
    desc: "下流側の圧力を設定値に維持し、上昇圧の伝播を遮断する。",
    basis: "技術書 §8.3 表-8.3.1「減圧バルブ」",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════

export function ProtectionCalculator({ excelData }: { excelData?: WorkbookData | null }) {
  const excelPipes = excelData?.pipes ?? [];

  const [deviceTab, setDeviceTab] = useState<DeviceTab>("air_chamber");
  const [base, setBase] = useState<BaseForm>(defaultBase);
  const [acForm, setAcForm] = useState<AirChamberForm>({ V_air0: "0.5", H_air0: "50", polytropicIndex: "1.2" });
  const [stForm, setStForm] = useState<SurgeTankForm>({ tankArea: "5", initialLevel: "50", datum: "0" });
  const [avForm, setAvForm] = useState<AirValveForm>({ atmosphericHead: "10.33" });
  const [prvForm, setPrvForm] = useState<PRVForm>({ setHead: "20" });

  const [snapWithIdx, setSnapWithIdx] = useState(0);
  const [snapWithoutIdx, setSnapWithoutIdx] = useState(0);

  // Excel データが読み込まれたら管路諸元を反映
  const [lastExcelLen, setLastExcelLen] = useState(0);
  if (excelPipes.length > 0 && excelPipes.length !== lastExcelLen) {
    setLastExcelLen(excelPipes.length);
    const pipe = excelPipes[0]!;
    setBase((f) => ({
      ...f,
      innerDiameter: String(pipe.innerDiameter * 1000),
      wallThickness: String(pipe.wallThickness * 1000),
      length: String(pipe.length),
    }));
  }

  function updBase<K extends keyof BaseForm>(k: K, v: BaseForm[K]) {
    setBase((f) => ({ ...f, [k]: v }));
    setSnapWithIdx(0); setSnapWithoutIdx(0);
  }

  useEffect(() => { setSnapWithIdx(0); setSnapWithoutIdx(0); }, [deviceTab]);

  // ── パース ────────────────────────────────────────────────────────────────
  const parsedBase = useMemo(() => {
    const D = parseFloat(base.innerDiameter) / 1000;
    const t = parseFloat(base.wallThickness) / 1000;
    const L = parseFloat(base.length);
    const Q0 = parseFloat(base.Q0_Ls) / 1000;
    const H0 = parseFloat(base.H0);
    const Hs = parseFloat(base.Hs);
    const sd = parseFloat(base.shutdownTime);
    const N = Math.max(4, Math.min(40, parseInt(base.nReaches, 10) || 10));
    if ([D, t, L, Q0, H0, Hs, sd].some(isNaN) || D <= 0 || Q0 <= 0 || H0 <= 0) return null;
    const basePipe = excelPipes.length > 0 ? excelPipes[0]! : DEMO_PIPE;
    const pipe: Pipe = { ...basePipe, innerDiameter: D, wallThickness: t, length: L };
    return { pipe, Q0, H0, Hs, sd, N };
  }, [base, excelPipes]);

  // ── 防護なし（ベースライン） ──────────────────────────────────────────────
  const resultWithout = useMemo<MocResult | null>(() => {
    if (!parsedBase) return null;
    const { pipe, Q0, H0, Hs, sd, N } = parsedBase;
    return runMocPumpTrip({
      pipe, waveSpeed: calcWaveSpeed(pipe),
      Q0, pumpHead: H0, Hs, shutdownTime: sd, checkValve: true, nReaches: N,
    });
  }, [parsedBase]);

  // ── 防護あり ──────────────────────────────────────────────────────────────
  const resultWith = useMemo<MocResult | null>(() => {
    if (!parsedBase) return null;
    const { pipe, Q0, H0, Hs, sd, N } = parsedBase;
    const a = calcWaveSpeed(pipe);

    if (deviceTab === "air_chamber") {
      const V0 = parseFloat(acForm.V_air0);
      const Ha0 = parseFloat(acForm.H_air0);
      const m = parseFloat(acForm.polytropicIndex);
      if ([V0, Ha0, m].some(isNaN) || V0 <= 0) return null;
      return runMoc({
        pipes: [{ id: "pipe_0", pipe, waveSpeed: a, nReaches: N,
                  upstreamNodeId: "pump_node", downstreamNodeId: "device_node" }],
        nodes: {
          pump_node: { type: "pump", Q0, H0, ...(Hs ? { Hs } : {}), shutdownTime: sd, checkValve: true },
          device_node: { type: "air_chamber", V_air0: V0, H_air0: Ha0, polytropicIndex: m },
        },
      }, { initialFlow: Q0 });
    }

    if (deviceTab === "surge_tank") {
      const As = parseFloat(stForm.tankArea);
      const z0 = parseFloat(stForm.initialLevel);
      const dat = parseFloat(stForm.datum) || 0;
      if ([As, z0].some(isNaN) || As <= 0) return null;
      return runMoc({
        pipes: [{ id: "pipe_0", pipe, waveSpeed: a, nReaches: N,
                  upstreamNodeId: "pump_node", downstreamNodeId: "device_node" }],
        nodes: {
          pump_node: { type: "pump", Q0, H0, ...(Hs ? { Hs } : {}), shutdownTime: sd, checkValve: true },
          device_node: { type: "surge_tank", tankArea: As, initialLevel: z0, datum: dat },
        },
      }, { initialFlow: Q0 });
    }

    if (deviceTab === "air_release_valve") {
      const Hatm = parseFloat(avForm.atmosphericHead) || 10.33;
      return runMoc({
        pipes: [{ id: "pipe_0", pipe, waveSpeed: a, nReaches: N,
                  upstreamNodeId: "pump_node", downstreamNodeId: "device_node" }],
        nodes: {
          pump_node: { type: "pump", Q0, H0, ...(Hs ? { Hs } : {}), shutdownTime: sd, checkValve: true },
          device_node: { type: "air_release_valve", atmosphericHead: Hatm },
        },
      }, { initialFlow: Q0 });
    }

    if (deviceTab === "prv") {
      const Hset = parseFloat(prvForm.setHead);
      if (isNaN(Hset)) return null;
      // PRV: 貯水槽 → 管路 → PRV（高水頭側の上昇圧遮断シナリオ）
      const HR = H0 * 2; // 仮想高圧貯水槽
      return runMoc({
        pipes: [{ id: "pipe_0", pipe, waveSpeed: a, nReaches: N,
                  upstreamNodeId: "reservoir", downstreamNodeId: "device_node" }],
        nodes: {
          reservoir: { type: "reservoir", head: HR },
          device_node: { type: "pressure_reducing_valve", setHead: Hset, Q0 },
        },
      }, { initialFlow: Q0 });
    }

    return null;
  }, [parsedBase, deviceTab, acForm, stForm, avForm, prvForm]);

  // ── 比較値取得 ────────────────────────────────────────────────────────────
  function getDownstreamKey(r: MocResult | null) {
    if (!r) return null;
    return Object.keys(r.nodes).find((k) => k !== "pump_node" && k !== "reservoir") ?? null;
  }

  const pipeWithout   = resultWithout?.pipes["pipe_0"] ?? null;
  const pipeWith      = resultWith?.pipes["pipe_0"] ?? null;
  const dnKeyWithout  = "dead_end_node";
  const dnKeyWith     = getDownstreamKey(resultWith);

  const HminWithout = (() => {
    const s = resultWithout?.nodes[dnKeyWithout]?.H ?? [];
    return s.length ? Math.min(...s.map((p) => p.H)) : 0;
  })();
  const HminWith = (() => {
    if (!dnKeyWith || !resultWith) return 0;
    const s = resultWith.nodes[dnKeyWith]?.H ?? [];
    return s.length ? Math.min(...s.map((p) => p.H)) : 0;
  })();
  const HmaxWithout = (() => {
    const s = resultWithout?.nodes[dnKeyWithout]?.H ?? [];
    return s.length ? Math.max(...s.map((p) => p.H)) : 0;
  })();
  const HmaxWith = (() => {
    if (!dnKeyWith || !resultWith) return 0;
    const s = resultWith.nodes[dnKeyWith]?.H ?? [];
    return s.length ? Math.max(...s.map((p) => p.H)) : 0;
  })();

  const info = DEVICE_INFO[deviceTab];

  // ── 設備固有入力 ─────────────────────────────────────────────────────────
  const deviceInputs: Record<DeviceTab, React.ReactElement> = {
    air_chamber: (
      <div className="input-group">
        <p className="input-group-title">エアチャンバ諸元</p>
        <div className="input-grid">
          <Field label="初期空気容積 V_a0" unit="m³" value={acForm.V_air0} onChange={(v) => setAcForm((f) => ({ ...f, V_air0: v }))} />
          <Field label="初期水頭 H_a0" unit="m" value={acForm.H_air0} onChange={(v) => setAcForm((f) => ({ ...f, H_air0: v }))} />
          <Field label="ポリトロープ指数 m" unit="-" value={acForm.polytropicIndex} onChange={(v) => setAcForm((f) => ({ ...f, polytropicIndex: v }))} />
        </div>
        <p className="demo-note">m: 等温=1.0 / 実用≈1.2 / 断熱=1.4</p>
      </div>
    ),
    surge_tank: (
      <div className="input-group">
        <p className="input-group-title">サージタンク諸元</p>
        <div className="input-grid">
          <Field label="断面積 A_s" unit="m²" value={stForm.tankArea} onChange={(v) => setStForm((f) => ({ ...f, tankArea: v }))} />
          <Field label="初期水位 z₀" unit="m" value={stForm.initialLevel} onChange={(v) => setStForm((f) => ({ ...f, initialLevel: v }))} />
          <Field label="基準高さ datum" unit="m" value={stForm.datum} min="-999" onChange={(v) => setStForm((f) => ({ ...f, datum: v }))} />
        </div>
      </div>
    ),
    air_release_valve: (
      <div className="input-group">
        <p className="input-group-title">吸気弁諸元</p>
        <div className="input-grid">
          <Field label="大気圧水頭 H_atm" unit="m" value={avForm.atmosphericHead} onChange={(v) => setAvForm((f) => ({ ...f, atmosphericHead: v }))} />
        </div>
        <p className="demo-note">標準大気圧: 10.33 m（101.3 kPa）</p>
      </div>
    ),
    prv: (
      <div className="input-group">
        <p className="input-group-title">減圧バルブ諸元</p>
        <div className="input-grid">
          <Field label="設定圧水頭 H_set" unit="m" value={prvForm.setHead} onChange={(v) => setPrvForm((f) => ({ ...f, setHead: v }))} />
        </div>
        <p className="demo-note">シナリオ: 高圧貯水槽 (2×H₀) → 管路 → PRV</p>
      </div>
    ),
  };

  return (
    <div className="card">
      <h2 className="card-title">水撃圧防護設備 効果比較（§8.3 / §8.5）</h2>

      {/* 設備タブ */}
      <div className="demo-tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {(Object.entries(DEVICE_INFO) as [DeviceTab, typeof DEVICE_INFO[DeviceTab]][]).map(([k, v]) => (
          <button key={k} className={`demo-tab${deviceTab === k ? " demo-tab--active" : ""}`}
            onClick={() => setDeviceTab(k)}>
            {v.label.split("（")[0]}
          </button>
        ))}
      </div>

      {/* 設備説明 */}
      <div style={{ background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 6,
                    padding: "10px 14px", marginBottom: 16, fontSize: "0.88rem" }}>
        <strong>{info.label}</strong>
        <p style={{ margin: "4px 0 2px" }}>{info.desc}</p>
        <p style={{ color: "#276749", margin: 0 }}>{info.basis}</p>
      </div>

      <div className="calculator-body">
        {/* 左: 入力 */}
        <div>
          <div className="input-group">
            <p className="input-group-title">管路諸元</p>
            <div className="input-grid">
              <Field label="内径 D" unit="mm" value={base.innerDiameter} onChange={(v) => updBase("innerDiameter", v)} />
              <Field label="管厚 t" unit="mm" value={base.wallThickness} onChange={(v) => updBase("wallThickness", v)} />
              <Field label="延長 L" unit="m"  value={base.length}        onChange={(v) => updBase("length", v)} />
            </div>
          </div>
          <div className="input-group">
            <p className="input-group-title">ポンプ急停止条件</p>
            <div className="input-grid">
              <Field label="定格流量 Q₀" unit="L/s" value={base.Q0_Ls}        onChange={(v) => updBase("Q0_Ls", v)} />
              <Field label="定格揚程 H₀" unit="m"   value={base.H0}           onChange={(v) => updBase("H0", v)} />
              <Field label="締切水頭 Hs" unit="m"   value={base.Hs}           onChange={(v) => updBase("Hs", v)} />
              <Field label="停止時間 t_d" unit="s"  value={base.shutdownTime} onChange={(v) => updBase("shutdownTime", v)} />
              <Field label="分割数 N"    unit="区間" value={base.nReaches}    min="4" onChange={(v) => updBase("nReaches", v)} />
            </div>
          </div>
          {deviceInputs[deviceTab]}
        </div>

        {/* 右: 比較サマリー */}
        <div>
          {(resultWithout && resultWith && pipeWithout) ? (
            <>
              <div className="result-section">
                <p className="result-section-title">防護効果 比較（末端水頭）</p>
                <table style={{ width: "100%", fontSize: "0.88rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #e2e8f0", color: "#4a5568" }}> </th>
                      <th style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid #e2e8f0", color: "#4a5568" }}>防護なし</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid #e2e8f0", color: "#2f855a" }}>防護あり</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid #e2e8f0", color: "#4299e1" }}>改善</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Hmax [m]", wo: HmaxWithout, wi: HmaxWith, better: (a: number, b: number) => b <= a },
                      { label: "Hmin [m]", wo: HminWithout, wi: HminWith, better: (a: number, b: number) => b >= a },
                    ].map(({ label, wo, wi, better }) => (
                      <tr key={label}>
                        <td style={{ padding: "4px 8px", color: "#4a5568" }}>{label}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }}>{n(wo, 1)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600,
                                      color: better(wo, wi) ? "#276749" : "#c53030" }}>
                          {n(wi, 1)}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "right", color: "#4299e1", fontSize: "0.82rem" }}>
                          {better(wo, wi) ? `▲ ${Math.abs(wi - wo).toFixed(1)}` : `▼ ${Math.abs(wi - wo).toFixed(1)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {HminWithout < 0 && HminWith >= 0 && (
                  <div style={{ marginTop: 8, padding: "6px 10px", background: "#f0fff4",
                                border: "1px solid #9ae6b4", borderRadius: 4, fontSize: "0.84rem", color: "#276749" }}>
                    負圧を完全に防止できています
                  </div>
                )}
                {HminWithout < 0 && HminWith < 0 && (
                  <div style={{ marginTop: 8, padding: "6px 10px", background: "#fff5f5",
                                border: "1px solid #feb2b2", borderRadius: 4, fontSize: "0.84rem", color: "#c53030" }}>
                    負圧は残存しています — 設備諸元の見直しを検討してください
                  </div>
                )}
              </div>

              <div className="result-section">
                <p className="result-section-title">計算条件</p>
                <div className="result-row">
                  <span className="result-label">波速 a</span>
                  <span className="result-value">{n(pipeWithout.waveSpeed, 1)}<span className="result-unit"> m/s</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">振動周期 T₀</span>
                  <span className="result-value">{n(pipeWithout.vibrationPeriod, 3)}<span className="result-unit"> s</span></span>
                </div>
                <div className="result-row">
                  <span className="result-label">Hmin [MPa]（防護なし）</span>
                  <span className="result-value" style={{ color: HminWithout < 0 ? "#e53e3e" : undefined }}>
                    {headToMpa(HminWithout).toFixed(4)}<span className="result-unit"> MPa</span>
                  </span>
                </div>
                <div className="result-row">
                  <span className="result-label">Hmin [MPa]（防護あり）</span>
                  <span className="result-value" style={{ color: "#276749" }}>
                    {headToMpa(HminWith).toFixed(4)}<span className="result-unit"> MPa</span>
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="result-empty">有効な入力値を確認してください</p>
          )}
        </div>
      </div>

      {/* グラフ比較エリア */}
      {resultWithout && resultWith && pipeWithout && pipeWith && (() => {
        const L = parsedBase?.pipe.length ?? 500;
        const H0ref = parsedBase?.H0 ?? 0;
        const dnH_wo = resultWithout.nodes[dnKeyWithout]?.H ?? [];
        const dnH_wi = dnKeyWith ? (resultWith.nodes[dnKeyWith]?.H ?? []) : [];
        const HR_wo = resultWithout.nodes["pump_node"]?.H[0]?.H ?? 0;

        return (
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 24 }}>

            {/* 横並び包絡線比較 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { label: "防護なし（ベースライン）", pipe: pipeWithout, snapIdx: snapWithoutIdx,
                  setSnapIdx: setSnapWithoutIdx, borderColor: "#fc8181" },
                { label: `防護あり（${info.label.split("（")[0]}）`, pipe: pipeWith, snapIdx: snapWithIdx,
                  setSnapIdx: setSnapWithIdx, borderColor: "#9ae6b4" },
              ].map(({ label, pipe: p, snapIdx: si, setSnapIdx: setSi, borderColor }) => (
                <div key={label} style={{ border: `2px solid ${borderColor}`, borderRadius: 8, padding: 10 }}>
                  <p style={{ margin: "0 0 8px", fontSize: "0.85rem", fontWeight: 600, color: "#2d3748" }}>
                    {label}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <input type="range" min={0} max={p.snapshots.length - 1} step={1}
                      value={si} onChange={(e) => setSi(Number(e.target.value))}
                      style={{ flex: 1 }} />
                    <span style={{ fontSize: "0.8rem", minWidth: 60, color: "#4a5568" }}>
                      t={p.snapshots[si]?.t.toFixed(2) ?? "0.00"}s
                    </span>
                  </div>
                  <MocEnvelopeChart pipeLength={L}
                    Hmax={p.Hmax} Hmin={p.Hmin} H_steady={p.H_steady}
                    snapshot={p.snapshots[si]?.H} snapshotTime={p.snapshots[si]?.t} />
                </div>
              ))}
            </div>

            {/* 時系列比較チャート */}
            {dnH_wo.length > 0 && (
              <div>
                <p className="result-section-title" style={{ marginBottom: 8 }}>末端水頭 H(t) 比較</p>
                <MocTimeChart downstreamH={dnH_wo} H0={H0ref} HR={HR_wo}
                  vibrationPeriod={pipeWithout.vibrationPeriod} />
                <p className="result-standard" style={{ marginTop: 4 }}>↑ 防護なし（ベースライン）</p>
                {dnH_wi.length > 0 && (
                  <>
                    <MocTimeChart downstreamH={dnH_wi} H0={H0ref} HR={HR_wo}
                      vibrationPeriod={pipeWithout.vibrationPeriod} />
                    <p className="result-standard" style={{ marginTop: 4 }}>
                      ↑ 防護あり（{info.label.split("（")[0]}）
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="result-footer" style={{ marginTop: 16 }}>
        <p className="result-standard">
          出典: 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8.3（水撃圧防護設備）/ §8.5（剛体理論）／
          特性曲線法（MOC）・弾性管モデル・準定常 H-W 摩擦
        </p>
      </div>
    </div>
  );
}
