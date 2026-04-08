/**
 * 計算セッション管理パネル
 *
 * 要旨 §3.2(6): 条件追跡機能
 * 要旨 §3.3:   入力条件・計算条件・結果の対応づけ管理
 * 要旨 §5.3:   条件変更時の再計算性
 * 要旨 §5.4:   条件追跡性（Excel出力含む）
 *
 * 機能:
 *   - セッション保存（localStorageに永続化）
 *   - セッション一覧・読み込み
 *   - 2セッション間の差分比較表示
 *   - セッションレポートExcel出力
 */

import { useState, useEffect } from "react";
import {
  createSession,
  diffSessions,
  summarizeMocResult,
} from "@open-waterhammer/core";
import type {
  CalculationSession,
  SessionDiffItem,
  LongitudinalHydraulicInput,
  LongitudinalHydraulicResult,
  MocResult,
} from "@open-waterhammer/core";
import type { MocNetwork, MocOptions } from "@open-waterhammer/core";

// excel-io は dynamic import で chunk 分離（INEFFECTIVE_DYNAMIC_IMPORT 警告対策）
async function loadExcelIo() {
  return import("@open-waterhammer/excel-io");
}

// ─── localStorage ───────────────────────────────────────────────────────────

const STORAGE_KEY = "owh_sessions";

function loadSessions(): CalculationSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: CalculationSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

// ─── コンポーネント ─────────────────────────────────────────────────────────

export interface SessionPanelProps {
  /** 現在の計算状態（外部から注入） */
  currentState?: {
    steadyInput?: LongitudinalHydraulicInput;
    steadyResult?: LongitudinalHydraulicResult;
    mocNetwork?: MocNetwork;
    mocOptions?: MocOptions;
    mocResult?: MocResult;
  };
}

export function SessionPanel({ currentState }: SessionPanelProps) {
  const [sessions, setSessions] = useState<CalculationSession[]>(() => loadSessions());
  const [sessionName, setSessionName] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [diffs, setDiffs] = useState<SessionDiffItem[] | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  function handleSave() {
    const name = sessionName.trim() || `セッション ${sessions.length + 1}`;
    let session = createSession({ name });

    if (currentState?.steadyInput) session.steadyInput = currentState.steadyInput;
    if (currentState?.steadyResult) session.steadyResult = currentState.steadyResult;
    if (currentState?.mocNetwork) session.mocNetwork = currentState.mocNetwork;
    if (currentState?.mocOptions) session.mocOptions = currentState.mocOptions;
    if (currentState?.mocResult) session.mocSummary = summarizeMocResult(currentState.mocResult);

    setSessions(prev => [...prev, session]);
    setSessionName("");
    setMessage(`「${name}」を保存しました`);
    setTimeout(() => setMessage(""), 3000);
  }

  function handleDelete(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id));
  }

  function handleCompare() {
    const a = sessions.find(s => s.id === compareA);
    const b = sessions.find(s => s.id === compareB);
    if (!a || !b) return;
    setDiffs(diffSessions(a, b));
  }

  async function handleExport(session: CalculationSession) {
    const { generateSessionReport } = await loadExcelIo();
    const buf = generateSessionReport({ session });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session_${session.name}_${session.id}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportComparison() {
    const a = sessions.find(s => s.id === compareA);
    const b = sessions.find(s => s.id === compareB);
    if (!a || !b || !diffs) return;
    const { generateSessionReport } = await loadExcelIo();
    const buf = generateSessionReport({ session: a, compareSession: b, diffs });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `comparison_${a.name}_vs_${b.name}.xlsx`;
    el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="calculator">
      <section className="card">
        <h2 className="card-title">計算セッション管理</h2>
        <p className="card-title-sub">条件追跡・差分比較・Excel出力</p>

        {/* セッション保存 */}
        <div className="input-group">
          <div className="input-field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="input-label">セッション名</label>
            <input
              className="input"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder="（例: ケースA バルブ2秒閉鎖）"
              style={{ flex: 1, maxWidth: 300 }}
            />
            <button className="btn btn--primary" onClick={handleSave}>
              現在の状態を保存
            </button>
          </div>
          {message && <p className="demo-note" style={{ color: "#38a169", marginTop: 4 }}>{message}</p>}
        </div>

        {/* セッション一覧 */}
        {sessions.length > 0 && (
          <>
            <h3 className="input-group-title" style={{ marginTop: 16 }}>保存済みセッション（{sessions.length}件）</h3>
            <div className="pipe-table-scroll">
              <table className="pipe-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>作成日時</th>
                    <th>管路数</th>
                    <th>定常</th>
                    <th>数値解析</th>
                    <th>変更数</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td style={{ fontSize: "0.8rem" }}>{new Date(s.createdAt).toLocaleString("ja-JP")}</td>
                      <td className="pipe-table-num">{s.pipes.length}</td>
                      <td className="pipe-table-num">{s.steadyResult ? "○" : "—"}</td>
                      <td className="pipe-table-num">{s.mocSummary ? "○" : "—"}</td>
                      <td className="pipe-table-num">{s.changes.length}</td>
                      <td style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn--small btn--secondary" onClick={() => handleExport(s)}>Excel</button>
                        <button className="btn btn--small btn--danger" onClick={() => handleDelete(s.id)}>削除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ケース比較 */}
        {sessions.length >= 2 && (
          <>
            <h3 className="input-group-title" style={{ marginTop: 16 }}>ケース比較</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select className="input" value={compareA} onChange={e => setCompareA(e.target.value)} style={{ minWidth: 180 }}>
                <option value="">ケースA を選択</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span>⇔</span>
              <select className="input" value={compareB} onChange={e => setCompareB(e.target.value)} style={{ minWidth: 180 }}>
                <option value="">ケースB を選択</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn btn--primary" onClick={handleCompare} disabled={!compareA || !compareB || compareA === compareB}>
                比較実行
              </button>
              {diffs && (
                <button className="btn btn--secondary" onClick={handleExportComparison}>
                  比較結果をExcel出力
                </button>
              )}
            </div>

            {/* 差分テーブル */}
            {diffs && (
              <div className="pipe-table-scroll" style={{ marginTop: 12 }}>
                <table className="pipe-table">
                  <thead>
                    <tr>
                      <th>区分</th>
                      <th>項目</th>
                      <th>{sessions.find(s => s.id === compareA)?.name ?? "A"}</th>
                      <th>{sessions.find(s => s.id === compareB)?.name ?? "B"}</th>
                      <th>変更</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d, i) => (
                      <tr key={i} style={d.changed ? { background: "#fffaf0" } : {}}>
                        <td>{d.category}</td>
                        <td>{d.label}</td>
                        <td className="pipe-table-num">{d.valueA ?? "—"}</td>
                        <td className="pipe-table-num">{d.valueB ?? "—"}</td>
                        <td style={{ textAlign: "center", color: d.changed ? "#e53e3e" : "#a0aec0" }}>
                          {d.changed ? "●" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {sessions.length === 0 && (
          <p className="demo-note" style={{ marginTop: 12 }}>
            計算結果をセッションとして保存すると、条件変更時の比較やExcel出力が可能になります。
          </p>
        )}
      </section>
    </div>
  );
}
