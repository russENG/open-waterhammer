/**
 * 経験則による水撃圧計算パネル
 * 出典: 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8.3.5
 */

import { useState, useMemo } from "react";
import { calcEmpiricalWaterhammer } from "@open-waterhammer/core";
import type { PipelineSystemType } from "@open-waterhammer/core";

// ─── 方式区分定義 ─────────────────────────────────────────────────────────────

const SYSTEM_OPTIONS: {
  value: PipelineSystemType;
  label: string;
  category: string;
  needsOperating: boolean;
  needsHydraulicGrade: boolean;
  staticLabel: string;
}[] = [
  {
    value: "gravity_open",
    label: "オープンタイプ",
    category: "自然圧送",
    needsOperating: false,
    needsHydraulicGrade: true,
    staticLabel: "静水圧 P₀",
  },
  {
    value: "gravity_semi_closed",
    label: "セミ・クローズドタイプ",
    category: "自然圧送",
    needsOperating: false,
    needsHydraulicGrade: false,
    staticLabel: "静水圧 P₀",
  },
  {
    value: "pump_distribution_tank",
    label: "配水槽方式",
    category: "ポンプ系",
    needsOperating: true,
    needsHydraulicGrade: false,
    staticLabel: "静水圧 P₀",
  },
  {
    value: "pump_direct",
    label: "直送方式",
    category: "ポンプ系",
    needsOperating: false,
    needsHydraulicGrade: false,
    staticLabel: "静水圧 P₀",
  },
  {
    value: "pump_pressure_tank",
    label: "圧力タンク方式",
    category: "ポンプ系",
    needsOperating: false,
    needsHydraulicGrade: false,
    staticLabel: "静水圧 P₀",
  },
];

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function EmpiricalCalculator() {
  const [systemType, setSystemType] = useState<PipelineSystemType>("gravity_semi_closed");
  const [staticPressure, setStaticPressure] = useState("0.30");
  const [operatingPressure, setOperatingPressure] = useState("0.30");
  const [hydraulicGradePressure, setHydraulicGradePressure] = useState("0.25");

  const selected = SYSTEM_OPTIONS.find((o) => o.value === systemType)!;

  const result = useMemo(() => {
    const sp = parseFloat(staticPressure);
    if (isNaN(sp) || sp <= 0) return null;
    const op = selected.needsOperating ? parseFloat(operatingPressure) : undefined;
    if (selected.needsOperating && (op === undefined || isNaN(op!) || op! <= 0)) return null;
    const hg = selected.needsHydraulicGrade ? parseFloat(hydraulicGradePressure) : undefined;
    if (selected.needsHydraulicGrade && (hg === undefined || isNaN(hg!) || hg! <= 0)) return null;
    return calcEmpiricalWaterhammer(systemType, sp, op, hg);
  }, [systemType, staticPressure, operatingPressure, hydraulicGradePressure, selected]);

  return (
    <div className="card">
      <h2 className="card-title">経験則による水撃圧（§8.3.5節）</h2>
      <div className="calculator-body">

        {/* ── 左カラム: 入力 ── */}
        <div>
          {/* 方式区分 */}
          <div className="input-group">
            <p className="input-group-title">パイプライン方式区分</p>
            <div className="empirical-system-grid">
              {["自然圧送", "ポンプ系"].map((cat) => (
                <div key={cat} className="empirical-category">
                  <p className="empirical-category-label">{cat}</p>
                  {SYSTEM_OPTIONS.filter((o) => o.category === cat).map((opt) => (
                    <label key={opt.value} className="empirical-radio-row">
                      <input
                        type="radio"
                        name="empirical-system"
                        value={opt.value}
                        checked={systemType === opt.value}
                        onChange={() => setSystemType(opt.value)}
                      />
                      <span className="empirical-radio-label">{opt.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* 圧力入力 */}
          <div className="input-group">
            <p className="input-group-title">圧力入力</p>
            <div className="input-grid">
              <div className="input-field">
                <span className="input-label">{selected.staticLabel}</span>
                <div className="input-control">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={staticPressure}
                    onChange={(e) => setStaticPressure(e.target.value)}
                  />
                  <span className="input-unit">MPa</span>
                </div>
              </div>

              {selected.needsOperating && (
                <div className="input-field">
                  <span className="input-label">通水時水圧 P</span>
                  <div className="input-control">
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={operatingPressure}
                      onChange={(e) => setOperatingPressure(e.target.value)}
                    />
                    <span className="input-unit">MPa</span>
                  </div>
                </div>
              )}

              {selected.needsHydraulicGrade && (
                <div className="input-field">
                  <span className="input-label">動水勾配線水圧 Phg</span>
                  <div className="input-control">
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={hydraulicGradePressure}
                      onChange={(e) => setHydraulicGradePressure(e.target.value)}
                    />
                    <span className="input-unit">MPa</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 右カラム: 結果 ── */}
        <div>
          {result ? (
            <>
              {result.warnings.length > 0 && (
                <div className="warnings">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="warning-item">
                      <span className="warning-icon">⚠</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="result-section">
                <p className="result-section-title">経験則水撃圧</p>
                <div className="result-row result-row--highlight">
                  <span className="result-label">水撃圧 ΔP</span>
                  <span className="result-value">
                    {result.waterhammerMpa.toFixed(3)}
                    <span className="result-unit"> MPa</span>
                  </span>
                </div>
              </div>

              <div className="result-section">
                <p className="result-section-title">適用判定式</p>
                <p className="result-note">{result.rule}</p>
              </div>

              <div className="result-footer">
                <p className="result-standard">
                  出典: 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8.3.5
                </p>
              </div>
            </>
          ) : (
            <p className="result-empty">有効な圧力値を入力してください</p>
          )}
        </div>
      </div>
    </div>
  );
}
