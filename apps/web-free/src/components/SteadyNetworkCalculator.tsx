/**
 * 管路網定常水理計算パネル
 *
 * 要旨 §3.1: 定常計算部で分岐・合流を含む管路網の水理条件を整理
 *
 * 樹枝状管路網（reservoir → junction → demand）の水理計算。
 * 結果はMOC初期条件として引き渡し可能。
 */

import { useState } from "react";
import { calcSteadyNetwork, headToMpa } from "@open-waterhammer/core";
import type {
  SteadyNetworkInput,
  NetworkPipeDef,
  NetworkNodeDef,
  SteadyNetworkResult,
} from "@open-waterhammer/core";

// ─── フォーム型 ──────────────────────────────────────────────────────────────

interface PipeFormRow {
  id: string;
  upstreamNodeId: string;
  downstreamNodeId: string;
  innerDiameter: string; // mm
  length: string;        // m
  roughnessC: string;
  minorLossCoeff: string;
}

interface NodeFormRow {
  id: string;
  elevation: string; // m
  type: "reservoir" | "demand" | "junction";
  head: string;      // m (reservoir)
  demand: string;    // m3/s (demand)
}

// ─── デモデータ ──────────────────────────────────────────────────────────────

function makeDemoData(): { pipes: PipeFormRow[]; nodes: NodeFormRow[] } {
  return {
    pipes: [
      { id: "幹線", upstreamNodeId: "貯水槽", downstreamNodeId: "分岐点", innerDiameter: "400", length: "800", roughnessC: "130", minorLossCoeff: "0" },
      { id: "支線A", upstreamNodeId: "分岐点", downstreamNodeId: "末端A", innerDiameter: "300", length: "500", roughnessC: "130", minorLossCoeff: "0.5" },
      { id: "支線B", upstreamNodeId: "分岐点", downstreamNodeId: "末端B", innerDiameter: "250", length: "600", roughnessC: "130", minorLossCoeff: "0.3" },
    ],
    nodes: [
      { id: "貯水槽", elevation: "100", type: "reservoir", head: "130", demand: "" },
      { id: "分岐点", elevation: "95", type: "junction", head: "", demand: "" },
      { id: "末端A", elevation: "88", type: "demand", head: "", demand: "0.10" },
      { id: "末端B", elevation: "85", type: "demand", head: "", demand: "0.06" },
    ],
  };
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function buildInput(pipes: PipeFormRow[], nodes: NodeFormRow[]): SteadyNetworkInput | null {
  const parsedPipes: NetworkPipeDef[] = [];
  for (const p of pipes) {
    const D = parseFloat(p.innerDiameter) / 1000;
    const L = parseFloat(p.length);
    const C = parseFloat(p.roughnessC);
    if (isNaN(D) || isNaN(L) || D <= 0 || L <= 0) return null;
    parsedPipes.push({
      id: p.id,
      upstreamNodeId: p.upstreamNodeId,
      downstreamNodeId: p.downstreamNodeId,
      innerDiameter: D,
      length: L,
      roughnessC: isNaN(C) ? 130 : C,
      minorLossCoeff: parseFloat(p.minorLossCoeff) || 0,
    });
  }

  const parsedNodes: NetworkNodeDef[] = [];
  for (const n of nodes) {
    const elev = parseFloat(n.elevation);
    if (isNaN(elev)) return null;
    parsedNodes.push({
      id: n.id,
      elevation: elev,
      type: n.type,
      ...(n.type === "reservoir" ? { head: parseFloat(n.head) || 0 } : {}),
      ...(n.type === "demand" ? { demand: parseFloat(n.demand) || 0 } : {}),
    });
  }

  return { pipes: parsedPipes, nodes: parsedNodes };
}

function n(v: number, d = 3): string { return v.toFixed(d); }

const NODE_TYPE_OPTIONS: { value: NetworkNodeDef["type"]; label: string }[] = [
  { value: "reservoir", label: "貯水槽（固定水頭）" },
  { value: "junction", label: "分岐・合流点" },
  { value: "demand", label: "末端需要" },
];

// ─── コンポーネント ─────────────────────────────────────────────────────────

export function SteadyNetworkCalculator() {
  const demo = makeDemoData();
  const [pipes, setPipes] = useState<PipeFormRow[]>(demo.pipes);
  const [nodes, setNodes] = useState<NodeFormRow[]>(demo.nodes);
  const [result, setResult] = useState<SteadyNetworkResult | null>(null);

  function updatePipe(idx: number, field: keyof PipeFormRow, value: string) {
    setPipes(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }
  function updateNode(idx: number, field: keyof NodeFormRow, value: string) {
    setNodes(prev => prev.map((nd, i) => i === idx ? { ...nd, [field]: value } : nd));
  }
  function addPipe() {
    const num = pipes.length + 1;
    setPipes(prev => [...prev, { id: `管路${num}`, upstreamNodeId: "", downstreamNodeId: "", innerDiameter: "300", length: "500", roughnessC: "130", minorLossCoeff: "0" }]);
  }
  function addNode() {
    const num = nodes.length + 1;
    setNodes(prev => [...prev, { id: `ノード${num}`, elevation: "0", type: "junction", head: "", demand: "" }]);
  }
  function removePipe(idx: number) { setPipes(prev => prev.filter((_, i) => i !== idx)); }
  function removeNode(idx: number) { setNodes(prev => prev.filter((_, i) => i !== idx)); }

  function handleCalc() {
    const input = buildInput(pipes, nodes);
    if (!input) {
      setResult(null);
      return;
    }
    setResult(calcSteadyNetwork(input));
  }

  function loadDemo() {
    const d = makeDemoData();
    setPipes(d.pipes);
    setNodes(d.nodes);
    setResult(null);
  }

  return (
    <div className="calculator">
      <section className="card">
        <h2 className="card-title">管路網定常水理計算</h2>
        <p className="card-title-sub">樹枝状管路網（分岐・合流）の定常水理条件を整理</p>

        <div style={{ marginBottom: 12 }}>
          <button className="btn btn--secondary" onClick={loadDemo}>
            デモ: T字分岐（貯水槽→分岐→末端2系統）
          </button>
        </div>

        {/* ノード定義 */}
        <h3 className="input-group-title">ノード（{nodes.length}箇所）</h3>
        <div className="pipe-table-scroll">
          <table className="pipe-table">
            <thead>
              <tr>
                <th>ノードID</th>
                <th>標高 [m]</th>
                <th>種別</th>
                <th>水頭H [m]</th>
                <th>需要Q [m³/s]</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((nd, i) => (
                <tr key={i}>
                  <td><input className="input input--narrow" value={nd.id} onChange={e => updateNode(i, "id", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={nd.elevation} onChange={e => updateNode(i, "elevation", e.target.value)} /></td>
                  <td>
                    <select className="input input--narrow" value={nd.type} onChange={e => updateNode(i, "type", e.target.value)}>
                      {NODE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td><input className="input input--narrow" type="number" value={nd.head} onChange={e => updateNode(i, "head", e.target.value)} disabled={nd.type !== "reservoir"} /></td>
                  <td><input className="input input--narrow" type="number" value={nd.demand} onChange={e => updateNode(i, "demand", e.target.value)} disabled={nd.type !== "demand"} /></td>
                  <td><button className="btn btn--small btn--danger" onClick={() => removeNode(i)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn--secondary" onClick={addNode} style={{ marginTop: 8 }}>ノード追加</button>

        {/* 管路定義 */}
        <h3 className="input-group-title" style={{ marginTop: 16 }}>管路（{pipes.length}本）</h3>
        <div className="pipe-table-scroll">
          <table className="pipe-table">
            <thead>
              <tr>
                <th>管路ID</th>
                <th>上流ノード</th>
                <th>下流ノード</th>
                <th>内径 [mm]</th>
                <th>延長 [m]</th>
                <th>粗度C</th>
                <th>局部損失Σf</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pipes.map((p, i) => (
                <tr key={i}>
                  <td><input className="input input--narrow" value={p.id} onChange={e => updatePipe(i, "id", e.target.value)} /></td>
                  <td><input className="input input--narrow" value={p.upstreamNodeId} onChange={e => updatePipe(i, "upstreamNodeId", e.target.value)} /></td>
                  <td><input className="input input--narrow" value={p.downstreamNodeId} onChange={e => updatePipe(i, "downstreamNodeId", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.innerDiameter} onChange={e => updatePipe(i, "innerDiameter", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.length} onChange={e => updatePipe(i, "length", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.roughnessC} onChange={e => updatePipe(i, "roughnessC", e.target.value)} /></td>
                  <td><input className="input input--narrow" type="number" value={p.minorLossCoeff} onChange={e => updatePipe(i, "minorLossCoeff", e.target.value)} /></td>
                  <td><button className="btn btn--small btn--danger" onClick={() => removePipe(i)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn--secondary" onClick={addPipe} style={{ marginTop: 8 }}>管路追加</button>

        {/* 計算実行 */}
        <div style={{ marginTop: 16 }}>
          <button className="btn btn--primary" onClick={handleCalc}>定常水理計算 実行</button>
        </div>
      </section>

      {/* 結果表示 */}
      {result && (
        <section className="card">
          <h2 className="card-title">定常水理計算結果</h2>

          <div className="report-preview" style={{ marginBottom: 16 }}>
            <div className="report-preview-item">
              <span className="report-preview-label">最大流速</span>
              <span className="report-preview-value">{n(result.maxVelocity, 2)} m/s</span>
            </div>
            <div className="report-preview-item">
              <span className="report-preview-label">最大動水頭</span>
              <span className="report-preview-value">{n(result.maxPressureHead, 2)} m</span>
            </div>
            <div className="report-preview-item">
              <span className="report-preview-label">最大圧力</span>
              <span className="report-preview-value">{n(headToMpa(result.maxPressureHead), 3)} MPa</span>
            </div>
          </div>

          {/* 警告 */}
          {result.warnings.length > 0 && (
            <div className="warnings" style={{ marginBottom: 12 }}>
              {result.warnings.map((w, i) => (
                <div key={i} className="warning-item"><span className="warning-icon">!</span>{w}</div>
              ))}
            </div>
          )}

          {/* ノード結果 */}
          <h3 className="input-group-title">ノード水頭</h3>
          <div className="pipe-table-scroll">
            <table className="pipe-table">
              <thead>
                <tr>
                  <th>ノードID</th>
                  <th>水頭H [m]</th>
                  <th>動水頭 [m]</th>
                  <th>静水圧 [MPa]</th>
                </tr>
              </thead>
              <tbody>
                {result.nodeResults.map(nr => (
                  <tr key={nr.nodeId}>
                    <td>{nr.nodeId}</td>
                    <td className="pipe-table-num">{n(nr.head, 2)}</td>
                    <td className="pipe-table-num">{n(nr.pressureHead, 2)}</td>
                    <td className="pipe-table-num">{n(nr.pressureMpa, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 管路結果 */}
          <h3 className="input-group-title" style={{ marginTop: 12 }}>管路水理量</h3>
          <div className="pipe-table-scroll">
            <table className="pipe-table">
              <thead>
                <tr>
                  <th>管路ID</th>
                  <th>流量Q [m³/s]</th>
                  <th>流速V [m/s]</th>
                  <th>摩擦損失 [m]</th>
                  <th>局部損失 [m]</th>
                  <th>全損失 [m]</th>
                  <th>動水勾配 [‰]</th>
                </tr>
              </thead>
              <tbody>
                {result.pipeResults.map(pr => (
                  <tr key={pr.pipeId}>
                    <td>{pr.pipeId}</td>
                    <td className="pipe-table-num">{n(pr.flow, 4)}</td>
                    <td className="pipe-table-num">{n(pr.velocity, 3)}</td>
                    <td className="pipe-table-num">{n(pr.frictionLoss, 3)}</td>
                    <td className="pipe-table-num">{n(pr.minorLoss, 3)}</td>
                    <td className="pipe-table-num">{n(pr.totalLoss, 3)}</td>
                    <td className="pipe-table-num">{n(pr.hydraulicGradient * 1000, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="demo-note" style={{ marginTop: 8 }}>
            この定常結果を水撃圧 数値解析の初期条件として使用できます。
            管路網 数値解析パネルで管路定義・境界条件を設定し、定常流量と水頭を初期値として入力してください。
          </p>
        </section>
      )}
    </div>
  );
}
