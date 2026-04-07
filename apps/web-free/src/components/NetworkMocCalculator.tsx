/**
 * 管路網 MOC 計算パネル
 *
 * 要旨 §4.1: 分岐・合流を含む管路系への適用
 * 要旨 §3.2(3): 弁操作・ポンプ停止等の非定常解析
 *
 * 複数管路セグメントとノード境界条件をテーブルUIで定義し、
 * MOCソルバーで一括解析する。
 */

import { useState, useMemo } from "react";
import {
  runMoc,
  calcWaveSpeed,
  headToMpa,
} from "@open-waterhammer/core";
import type {
  Pipe,
  PipeType,
  MocResult,
} from "@open-waterhammer/core";
import type {
  MocNetwork,
  MocPipeSegment,
  BoundaryCondition,
} from "@open-waterhammer/core";
import { MocTimeChart } from "./MocTimeChart";
import { MocEnvelopeChart } from "./MocEnvelopeChart";
import { ChartFrame } from "./ChartFrame";

// ─── フォーム型 ──────────────────────────────────────────────────────────────

interface PipeRow {
  id: string;
  pipeType: PipeType;
  innerDiameter: string; // mm
  wallThickness: string; // mm
  length: string;        // m
  roughnessC: string;
  upNode: string;
  downNode: string;
  initialFlow: string;   // m3/s
  nReaches: string;
}

interface NodeRow {
  id: string;
  bcType: BoundaryCondition["type"];
  // reservoir
  head: string;
  // valve
  Q0: string;
  H0v: string;
  closeTime: string;
  operation: "close" | "open";
  // pump
  pumpHead: string;
  shutdownTime: string;
  // air_chamber
  airVolume: string;   // V_a0 [m3]
  airHead: string;     // H_a0 [m]
  polytropicIndex: string; // m (1.0〜1.4)
  // surge_tank
  tankArea: string;    // A_s [m2]
  tankLevel: string;   // z0 [m]
  tankDatum: string;   // datum [m]
  // air_release_valve — no extra params (atmospheric head default)
  // pressure_reducing_valve
  setHead: string;     // H_set [m]
  // dead_end — no extra params
}

const DEFAULT_PIPE: PipeRow = {
  id: "pipe_1",
  pipeType: "ductile_iron",
  innerDiameter: "300",
  wallThickness: "8.0",
  length: "1000",
  roughnessC: "130",
  upNode: "N1",
  downNode: "N2",
  initialFlow: "0.10",
  nReaches: "10",
};

const PIPE_TYPE_OPTIONS: { value: PipeType; label: string }[] = [
  { value: "ductile_iron", label: "DCIP（ダクタイル鋳鉄管）" },
  { value: "steel", label: "SP（鋼管）" },
  { value: "upvc", label: "PVC（硬質塩ビ管）" },
  { value: "pe3_pe100", label: "PE（ポリエチレン管）" },
];

const BC_TYPE_OPTIONS: { value: BoundaryCondition["type"]; label: string }[] = [
  { value: "reservoir", label: "貯水槽（固定水頭）" },
  { value: "valve", label: "バルブ（開閉操作）" },
  { value: "pump", label: "ポンプ" },
  { value: "air_chamber", label: "エアチャンバ（圧力タンク）" },
  { value: "surge_tank", label: "サージタンク（調圧水槽）" },
  { value: "air_release_valve", label: "吸気弁（負圧開放弁）" },
  { value: "pressure_reducing_valve", label: "減圧バルブ" },
  { value: "dead_end", label: "行き止まり" },
];

// ─── デモ: T字分岐 ──────────────────────────────────────────────────────────

function makeDemoTJunction(): { pipes: PipeRow[]; nodes: NodeRow[] } {
  return {
    pipes: [
      { id: "pipe_1", pipeType: "ductile_iron", innerDiameter: "400", wallThickness: "9.0", length: "800", roughnessC: "130", upNode: "reservoir", downNode: "junction", initialFlow: "0.20", nReaches: "10" },
      { id: "pipe_2", pipeType: "ductile_iron", innerDiameter: "300", wallThickness: "8.0", length: "500", roughnessC: "130", upNode: "junction", downNode: "valve_A", initialFlow: "0.12", nReaches: "10" },
      { id: "pipe_3", pipeType: "ductile_iron", innerDiameter: "250", wallThickness: "7.5", length: "600", roughnessC: "130", upNode: "junction", downNode: "valve_B", initialFlow: "0.08", nReaches: "10" },
    ],
    nodes: [
      { id: "reservoir", bcType: "reservoir", head: "50", Q0: "", H0v: "", closeTime: "", operation: "close", pumpHead: "", shutdownTime: "", airVolume: "", airHead: "", polytropicIndex: "1.2", tankArea: "", tankLevel: "", tankDatum: "0", setHead: "" },
      { id: "valve_A", bcType: "valve", head: "", Q0: "0.12", H0v: "30", closeTime: "2.0", operation: "close", pumpHead: "", shutdownTime: "", airVolume: "", airHead: "", polytropicIndex: "1.2", tankArea: "", tankLevel: "", tankDatum: "0", setHead: "" },
      { id: "valve_B", bcType: "valve", head: "", Q0: "0.08", H0v: "28", closeTime: "3.0", operation: "close", pumpHead: "", shutdownTime: "", airVolume: "", airHead: "", polytropicIndex: "1.2", tankArea: "", tankLevel: "", tankDatum: "0", setHead: "" },
    ],
  };
}

// ─── ヘルパー ───────────��────────────────────────────────────────────────────

function collectNodeIds(pipes: PipeRow[]): string[] {
  const ids = new Set<string>();
  for (const p of pipes) {
    if (p.upNode.trim()) ids.add(p.upNode.trim());
    if (p.downNode.trim()) ids.add(p.downNode.trim());
  }
  return [...ids];
}

function isInternalJunction(nodeId: string, pipes: PipeRow[]): boolean {
  // 2本以上の管路に接続するノードは内部接続（自動的に連続条件）
  let count = 0;
  for (const p of pipes) {
    if (p.upNode.trim() === nodeId) count++;
    if (p.downNode.trim() === nodeId) count++;
  }
  return count >= 2;
}

function buildNetwork(pipes: PipeRow[], nodes: NodeRow[]): { network: MocNetwork; errors: string[] } | null {
  const errors: string[] = [];
  const mocPipes: MocPipeSegment[] = [];

  for (const row of pipes) {
    const D = parseFloat(row.innerDiameter) / 1000;
    const t = parseFloat(row.wallThickness) / 1000;
    const L = parseFloat(row.length);
    const C = parseFloat(row.roughnessC);
    const Q0 = parseFloat(row.initialFlow);
    const N = parseInt(row.nReaches) || 10;

    if (isNaN(D) || isNaN(t) || isNaN(L) || D <= 0 || t <= 0 || L <= 0) {
      errors.push(`${row.id}: 管路諸元が不正です`);
      continue;
    }

    const pipe: Pipe = {
      id: row.id,
      startNodeId: row.upNode.trim(),
      endNodeId: row.downNode.trim(),
      pipeType: row.pipeType,
      innerDiameter: D,
      wallThickness: t,
      length: L,
      roughnessCoeff: isNaN(C) ? 130 : C,
    };

    const waveSpeed = calcWaveSpeed(pipe);

    mocPipes.push({
      id: row.id,
      pipe,
      waveSpeed,
      nReaches: N,
      upstreamNodeId: row.upNode.trim(),
      downstreamNodeId: row.downNode.trim(),
      ...(isNaN(Q0) ? {} : { initialFlow: Q0 }),
    });
  }

  const bcNodes: Record<string, BoundaryCondition> = {};
  for (const n of nodes) {
    const bc = buildBC(n);
    if (bc) bcNodes[n.id] = bc;
    else errors.push(`${n.id}: 境界条件のパラメータが不正です`);
  }

  if (errors.length > 0) return { network: { pipes: mocPipes, nodes: bcNodes }, errors };
  if (mocPipes.length === 0) return null;

  return { network: { pipes: mocPipes, nodes: bcNodes }, errors };
}

function buildBC(n: NodeRow): BoundaryCondition | null {
  switch (n.bcType) {
    case "reservoir": {
      const head = parseFloat(n.head);
      if (isNaN(head)) return null;
      return { type: "reservoir", head };
    }
    case "valve": {
      const Q0 = parseFloat(n.Q0);
      const H0v = parseFloat(n.H0v);
      const closeTime = parseFloat(n.closeTime);
      if (isNaN(Q0) || isNaN(H0v) || isNaN(closeTime)) return null;
      return { type: "valve", Q0, H0v, closeTime, operation: n.operation };
    }
    case "pump": {
      const Q0 = parseFloat(n.Q0);
      const H0 = parseFloat(n.pumpHead);
      const shutdownTime = parseFloat(n.shutdownTime) || 0;
      if (isNaN(Q0) || isNaN(H0)) return null;
      return { type: "pump", Q0, H0, shutdownTime, mode: "trip" };
    }
    case "air_chamber": {
      const V_air0 = parseFloat(n.airVolume);
      const H_air0 = parseFloat(n.airHead);
      if (isNaN(V_air0) || isNaN(H_air0)) return null;
      const m = parseFloat(n.polytropicIndex);
      return { type: "air_chamber", V_air0, H_air0, ...(isNaN(m) ? {} : { polytropicIndex: m }) };
    }
    case "surge_tank": {
      const tankArea = parseFloat(n.tankArea);
      const initialLevel = parseFloat(n.tankLevel);
      if (isNaN(tankArea) || isNaN(initialLevel)) return null;
      const datum = parseFloat(n.tankDatum) || 0;
      return { type: "surge_tank", tankArea, initialLevel, datum };
    }
    case "air_release_valve":
      return { type: "air_release_valve" };
    case "pressure_reducing_valve": {
      const setHead = parseFloat(n.setHead);
      const Q0 = parseFloat(n.Q0);
      if (isNaN(setHead) || isNaN(Q0)) return null;
      return { type: "pressure_reducing_valve", setHead, Q0 };
    }
    case "dead_end":
      return { type: "dead_end" };
    default:
      return null;
  }
}

// ─── コンポーネント ──────────────────────────────────────────────────────────

export function NetworkMocCalculator() {
  const demo = makeDemoTJunction();
  const [pipes, setPipes] = useState<PipeRow[]>(demo.pipes);
  const [nodes, setNodes] = useState<NodeRow[]>(demo.nodes);
  const [tMax, setTMax] = useState("20");
  const [result, setResult] = useState<MocResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedPipe, setSelectedPipe] = useState("");
  const [selectedNode, setSelectedNode] = useState("");

  // ノードID一覧（管路定義から自動収集）
  const allNodeIds = useMemo(() => collectNodeIds(pipes), [pipes]);
  // 内部ジャンクション（BCを設定しない）
  const junctionIds = useMemo(() => allNodeIds.filter(id => isInternalJunction(id, pipes)), [allNodeIds, pipes]);
  // 端末ノード（BC必要）
  const terminalIds = useMemo(() => allNodeIds.filter(id => !junctionIds.includes(id)), [allNodeIds, junctionIds]);

  function updatePipe(idx: number, field: keyof PipeRow, value: string) {
    setPipes(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  function addPipe() {
    const num = pipes.length + 1;
    setPipes(prev => [...prev, { ...DEFAULT_PIPE, id: `pipe_${num}`, upNode: `N${num * 2 - 1}`, downNode: `N${num * 2}` }]);
  }

  function removePipe(idx: number) {
    setPipes(prev => prev.filter((_, i) => i !== idx));
  }

  function updateNode(idx: number, field: keyof NodeRow, value: string) {
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n));
  }

  function addNode(id: string) {
    setNodes(prev => [...prev, { id, bcType: "dead_end", head: "", Q0: "", H0v: "", closeTime: "", operation: "close" as const, pumpHead: "", shutdownTime: "", airVolume: "", airHead: "", polytropicIndex: "1.2", tankArea: "", tankLevel: "", tankDatum: "0", setHead: "" }]);
  }

  function removeNode(idx: number) {
    setNodes(prev => prev.filter((_, i) => i !== idx));
  }

  // ノード同期: 端末ノードでBC未定義のものを自動追加
  useMemo(() => {
    const existing = new Set(nodes.map(n => n.id));
    const missing = terminalIds.filter(id => !existing.has(id));
    if (missing.length > 0) {
      for (const id of missing) addNode(id);
    }
  }, [terminalIds]);

  function handleRun() {
    const built = buildNetwork(pipes, nodes);
    if (!built) {
      setErrors(["管路データがありません"]);
      setResult(null);
      return;
    }
    if (built.errors.length > 0) {
      setErrors(built.errors);
    } else {
      setErrors([]);
    }
    try {
      const t = parseFloat(tMax);
      const res = runMoc(built.network, { tMax: isNaN(t) ? undefined : t });
      setResult(res);
      // 最初の管路を選択
      const firstPipeId = Object.keys(res.pipes)[0];
      if (firstPipeId) setSelectedPipe(firstPipeId);
      const firstNodeId = Object.keys(res.nodes)[0];
      if (firstNodeId) setSelectedNode(firstNodeId);
    } catch (e: any) {
      setErrors(prev => [...prev, `MOC実行エラー: ${e.message}`]);
      setResult(null);
    }
  }

  function loadDemo() {
    const d = makeDemoTJunction();
    setPipes(d.pipes);
    setNodes(d.nodes);
    setResult(null);
    setErrors([]);
  }

  // 結果の取り出し
  const pipeResult = result && selectedPipe ? result.pipes[selectedPipe] : null;
  const nodeResult = result && selectedNode ? result.nodes[selectedNode] : null;

  return (
    <div className="calculator">
      <section className="card">
        <h2 className="card-title">管路網 MOC 解析</h2>
        <p className="card-title-sub">分岐・合流を含む管路網の非定常解析</p>

        {/* デモ読み込み */}
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn--secondary" onClick={loadDemo}>
            デモ: T字分岐（貯水槽→分岐→バルブ2基）
          </button>
        </div>

        {/* 管路セグメント定義 */}
        <h3 className="input-group-title">管路セグメント（{pipes.length}本）</h3>
        <div className="pipe-table-scroll">
          <table className="pipe-table">
            <thead>
              <tr>
                <th>管路ID</th>
                <th>管種</th>
                <th>内径 [mm]</th>
                <th>管厚 [mm]</th>
                <th>延�� [m]</th>
                <th>粗度C</th>
                <th>上流ノード</th>
                <th>下流ノー���</th>
                <th>初期流量 [m3/s]</th>
                <th>分割数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pipes.map((p, i) => (
                <tr key={i}>
                  <td><input className="input input--narrow" value={p.id} onChange={e => updatePipe(i, "id", e.target.value)} /></td>
                  <td>
                    <select className="input input--narrow" value={p.pipeType} onChange={e => updatePipe(i, "pipeType", e.target.value)}>
                      {PIPE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td><input className="input input--narrow" type="number" value={p.innerDiameter} onChange={e => updatePipe(i, "innerDiameter", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.wallThickness} onChange={e => updatePipe(i, "wallThickness", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.length} onChange={e => updatePipe(i, "length", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.roughnessC} onChange={e => updatePipe(i, "roughnessC", e.target.value)} /></td>
                  <td><input className="input input--narrow" value={p.upNode} onChange={e => updatePipe(i, "upNode", e.target.value)} /></td>
                  <td><input className="input input--narrow" value={p.downNode} onChange={e => updatePipe(i, "downNode", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.initialFlow} onChange={e => updatePipe(i, "initialFlow", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.nReaches} onChange={e => updatePipe(i, "nReaches", e.target.value)} /></td>
                  <td><button className="btn btn--small btn--danger" onClick={() => removePipe(i)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn--secondary" onClick={addPipe} style={{ marginTop: 8 }}>管路を追加</button>

        {/* ノード構成表示 */}
        <h3 className="input-group-title" style={{ marginTop: 16 }}>ノード構成</h3>
        {junctionIds.length > 0 && (
          <p className="demo-note">
            内部接続ノード（自動連続条件）: {junctionIds.join(", ")}
          </p>
        )}

        {/* 端末ノード境界条件 */}
        <h3 className="input-group-title" style={{ marginTop: 12 }}>端末ノード境界条件（{nodes.length}箇所）</h3>
        {nodes.map((n, i) => (
          <div key={i} className="bc-card" style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", marginBottom: 8, background: "#fafbfc" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label className="input-label" style={{ minWidth: 60 }}>ノードID</label>
              <input className="input input--narrow" value={n.id} onChange={e => updateNode(i, "id", e.target.value)} />
              <label className="input-label" style={{ minWidth: 50 }}>BC種別</label>
              <select className="input" style={{ minWidth: 180 }} value={n.bcType} onChange={e => updateNode(i, "bcType", e.target.value)}>
                {BC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button className="btn btn--small btn--danger" onClick={() => removeNode(i)}>削除</button>
            </div>
            {/* BC種別ごとのパラメータ */}
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              {n.bcType === "reservoir" && (
                <><label className="input-label">水頭H [m]</label><input className="input input--narrow" type="number" value={n.head} onChange={e => updateNode(i, "head", e.target.value)} /></>
              )}
              {n.bcType === "valve" && (
                <>
                  <label className="input-label">Q0 [m³/s]</label><input className="input input--narrow" type="number" value={n.Q0} onChange={e => updateNode(i, "Q0", e.target.value)} />
                  <label className="input-label">H0v [m]</label><input className="input input--narrow" type="number" value={n.H0v} onChange={e => updateNode(i, "H0v", e.target.value)} />
                  <label className="input-label">閉鎖時間 [s]</label><input className="input input--narrow" type="number" value={n.closeTime} onChange={e => updateNode(i, "closeTime", e.target.value)} />
                  <label className="input-label">操作</label>
                  <select className="input input--narrow" value={n.operation} onChange={e => updateNode(i, "operation", e.target.value)}>
                    <option value="close">閉</option><option value="open">開</option>
                  </select>
                </>
              )}
              {n.bcType === "pump" && (
                <>
                  <label className="input-label">Q0 [m³/s]</label><input className="input input--narrow" type="number" value={n.Q0} onChange={e => updateNode(i, "Q0", e.target.value)} />
                  <label className="input-label">揚程H0 [m]</label><input className="input input--narrow" type="number" value={n.pumpHead} onChange={e => updateNode(i, "pumpHead", e.target.value)} />
                  <label className="input-label">停止時間 [s]</label><input className="input input--narrow" type="number" value={n.shutdownTime} onChange={e => updateNode(i, "shutdownTime", e.target.value)} />
                </>
              )}
              {n.bcType === "air_chamber" && (
                <>
                  <label className="input-label">空気容積V₀ [m³]</label><input className="input input--narrow" type="number" value={n.airVolume} onChange={e => updateNode(i, "airVolume", e.target.value)} />
                  <label className="input-label">初期水頭H₀ [m]</label><input className="input input--narrow" type="number" value={n.airHead} onChange={e => updateNode(i, "airHead", e.target.value)} />
                  <label className="input-label">ポリトロープ指数m</label><input className="input input--narrow" type="number" value={n.polytropicIndex} onChange={e => updateNode(i, "polytropicIndex", e.target.value)} />
                </>
              )}
              {n.bcType === "surge_tank" && (
                <>
                  <label className="input-label">断面積A [m²]</label><input className="input input--narrow" type="number" value={n.tankArea} onChange={e => updateNode(i, "tankArea", e.target.value)} />
                  <label className="input-label">初期水位z₀ [m]</label><input className="input input--narrow" type="number" value={n.tankLevel} onChange={e => updateNode(i, "tankLevel", e.target.value)} />
                  <label className="input-label">基準高datum [m]</label><input className="input input--narrow" type="number" value={n.tankDatum} onChange={e => updateNode(i, "tankDatum", e.target.value)} />
                </>
              )}
              {n.bcType === "air_release_valve" && (
                <span className="demo-note" style={{ margin: 0 }}>パラメータなし（大気圧水頭 10.33 m で自動開放）</span>
              )}
              {n.bcType === "pressure_reducing_valve" && (
                <>
                  <label className="input-label">設定水頭H [m]</label><input className="input input--narrow" type="number" value={n.setHead} onChange={e => updateNode(i, "setHead", e.target.value)} />
                  <label className="input-label">Q0 [m³/s]</label><input className="input input--narrow" type="number" value={n.Q0} onChange={e => updateNode(i, "Q0", e.target.value)} />
                </>
              )}
              {n.bcType === "dead_end" && (
                <span className="demo-note" style={{ margin: 0 }}>パラメータなし（Q=0 固定端）</span>
              )}
            </div>
          </div>
        ))}

        {/* 解析実行 */}
        <div className="input-group" style={{ marginTop: 16 }}>
          <div className="input-field" style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
            <label className="input-label">シミュレーション時間 [s]</label>
            <input className="input" type="number" value={tMax} onChange={e => setTMax(e.target.value)} style={{ width: 100 }} />
            <button className="btn btn--primary" onClick={handleRun}>MOC 解析実行</button>
          </div>
        </div>

        {/* エラー表示 */}
        {errors.length > 0 && (
          <div className="warnings" style={{ marginTop: 8 }}>
            {errors.map((e, i) => (
              <div key={i} className="warning-item"><span className="warning-icon">!</span>{e}</div>
            ))}
          </div>
        )}
      </section>

      {/* 結果表示 */}
      {result && (
        <section className="card">
          <h2 className="card-title">解析結果</h2>

          {/* 結果サマリー */}
          <div className="report-preview" style={{ marginBottom: 16 }}>
            <div className="report-preview-item">
              <span className="report-preview-label">dt</span>
              <span className="report-preview-value">{result.dt.toFixed(4)} s</span>
            </div>
            <div className="report-preview-item">
              <span className="report-preview-label">tMax</span>
              <span className="report-preview-value">{result.tMax.toFixed(2)} s</span>
            </div>
            <div className="report-preview-item">
              <span className="report-preview-label">管路数</span>
              <span className="report-preview-value">{Object.keys(result.pipes).length}</span>
            </div>
            <div className="report-preview-item">
              <span className="report-preview-label">ノード���</span>
              <span className="report-preview-value">{Object.keys(result.nodes).length}</span>
            </div>
          </div>

          {/* 管路別包絡線サマリー */}
          <h3 className="input-group-title">管路別 最大・最小水頭</h3>
          <div className="pipe-table-scroll">
            <table className="pipe-table">
              <thead>
                <tr>
                  <th>管路ID</th>
                  <th>波速 [m/s]</th>
                  <th>振動周期 [s]</th>
                  <th>Hmax [m]</th>
                  <th>Hmin [m]</th>
                  <th>Hmax [MPa]</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.pipes).map(([id, pr]) => (
                  <tr key={id} className={selectedPipe === id ? "pipe-table-selected" : ""} onClick={() => setSelectedPipe(id)} style={{ cursor: "pointer" }}>
                    <td>{id}</td>
                    <td className="pipe-table-num">{pr.waveSpeed.toFixed(1)}</td>
                    <td className="pipe-table-num">{pr.vibrationPeriod.toFixed(3)}</td>
                    <td className="pipe-table-num pipe-table-computed">{Math.max(...pr.Hmax).toFixed(2)}</td>
                    <td className="pipe-table-num pipe-table-computed">{Math.min(...pr.Hmin).toFixed(2)}</td>
                    <td className="pipe-table-num pipe-table-computed">{headToMpa(Math.max(...pr.Hmax)).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 選択管路の包絡線チャート */}
          {pipeResult && (
            <div style={{ marginTop: 16 }}>
              <h3 className="input-group-title">包絡線: {selectedPipe}</h3>
              <ChartFrame filename={`network_envelope_${selectedPipe}`}>
                <MocEnvelopeChart
                  pipeLength={pipeResult.dx * pipeResult.nReaches}
                  Hmax={pipeResult.Hmax}
                  Hmin={pipeResult.Hmin}
                  H_steady={pipeResult.H_steady}
                />
              </ChartFrame>
            </div>
          )}

          {/* ノード別水頭時系列 */}
          <h3 className="input-group-title" style={{ marginTop: 16 }}>ノード水頭時系��</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {Object.keys(result.nodes).map(nid => (
              <button
                key={nid}
                className={`btn btn--small${selectedNode === nid ? " btn--primary" : " btn--secondary"}`}
                onClick={() => setSelectedNode(nid)}
              >
                {nid}
              </button>
            ))}
          </div>
          {nodeResult && (() => {
            const heads = nodeResult.H.map(h => h.H);
            const H0 = heads[0] ?? 0;
            const firstPipeKey = Object.keys(result.pipes)[0];
            const vibPeriod = firstPipeKey ? result.pipes[firstPipeKey]!.vibrationPeriod : 1;
            const reservoirNode = nodes.find(n => n.bcType === "reservoir");
            const HR = reservoirNode ? parseFloat(reservoirNode.head) || H0 : H0;
            return (
              <div>
                <p className="demo-note">
                  最大水頭: {Math.max(...heads).toFixed(2)} m
                  {" / "}最小水頭: {Math.min(...heads).toFixed(2)} m
                </p>
                <ChartFrame filename={`network_node_${selectedNode}`}>
                  <MocTimeChart
                    downstreamH={nodeResult.H}
                    H0={H0}
                    HR={HR}
                    vibrationPeriod={vibPeriod}
                  />
                </ChartFrame>
              </div>
            );
          })()}
        </section>
      )}
    </div>
  );
}
