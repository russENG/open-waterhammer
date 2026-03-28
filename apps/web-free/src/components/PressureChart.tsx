/**
 * 圧力内訳チャート（SVG）
 * 静水圧・水撃圧・設計水圧・許容圧力を水平バーで比較表示
 */

import type { JudgementResult } from "@open-waterhammer/core";

interface PressureChartProps {
  staticMpa: number;
  hammerMpa: number;
  judgement: JudgementResult | null;
}

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const W = 480;
const H = 220;
const PADDING = { top: 24, right: 80, bottom: 48, left: 120 };
const BAR_H = 26;
const BAR_GAP = 16;

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function scaleX(value: number, max: number): number {
  const availW = W - PADDING.left - PADDING.right;
  return PADDING.left + (value / max) * availW;
}

function barY(index: number): number {
  return PADDING.top + index * (BAR_H + BAR_GAP);
}

const STATUS_COLOR = {
  ok: "#48bb78",
  warning: "#ed8936",
  ng: "#e53e3e",
} as const;

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function PressureChart({ staticMpa, hammerMpa, judgement }: PressureChartProps) {
  const designMpa = staticMpa + hammerMpa;
  const allowableMpa = judgement?.allowablePressureMpa ?? designMpa * 1.3;
  const maxMpa = Math.max(allowableMpa, designMpa) * 1.15;
  const statusColor = judgement ? STATUS_COLOR[judgement.status] : "#3a86ff";

  const bars = [
    { label: "静水圧", value: staticMpa, color: "#90cdf4", sub: `${staticMpa.toFixed(3)} MPa` },
    { label: "水撃圧", value: hammerMpa, color: "#fbb6ce", sub: `${hammerMpa.toFixed(3)} MPa` },
    { label: "設計水圧", value: designMpa, color: statusColor, sub: `${designMpa.toFixed(3)} MPa` },
  ];

  const availW = W - PADDING.left - PADDING.right;
  const allowableX = scaleX(allowableMpa, maxMpa);

  // X 軸目盛（4等分）
  const ticks = Array.from({ length: 5 }, (_, i) => (maxMpa / 4) * i);

  return (
    <div className="pressure-chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", maxWidth: W }}
        aria-label="圧力内訳チャート"
      >
        {/* グリッド線 */}
        {ticks.map((t) => {
          const x = scaleX(t, maxMpa);
          return (
            <line
              key={t}
              x1={x} y1={PADDING.top - 8}
              x2={x} y2={H - PADDING.bottom + 4}
              stroke="#e2e8f0" strokeWidth="1"
            />
          );
        })}

        {/* 許容圧力ライン */}
        <line
          x1={allowableX} y1={PADDING.top - 8}
          x2={allowableX} y2={H - PADDING.bottom + 4}
          stroke="#718096" strokeWidth="1.5" strokeDasharray="4 3"
        />
        <text
          x={allowableX + 4} y={PADDING.top - 2}
          fontSize="10" fill="#718096" fontFamily="system-ui, sans-serif"
        >
          許容 {allowableMpa.toFixed(3)} MPa
        </text>

        {/* バー */}
        {bars.map((bar, i) => {
          const x1 = PADDING.left;
          const x2 = scaleX(bar.value, maxMpa);
          const y = barY(i);
          const barW = Math.max(x2 - x1, 2);

          return (
            <g key={bar.label}>
              {/* ラベル */}
              <text
                x={PADDING.left - 8} y={y + BAR_H / 2 + 4}
                fontSize="11" fill="#4a5568"
                textAnchor="end"
                fontFamily="system-ui, sans-serif"
              >
                {bar.label}
              </text>
              {/* バー背景 */}
              <rect
                x={PADDING.left}
                y={y}
                width={availW}
                height={BAR_H}
                fill="#f7fafc"
                rx="3"
              />
              {/* バー */}
              <rect
                x={x1} y={y}
                width={barW} height={BAR_H}
                fill={bar.color}
                rx="3"
                opacity={0.85}
              />
              {/* 値ラベル */}
              <text
                x={x2 + 6} y={y + BAR_H / 2 + 4}
                fontSize="11" fill="#2d3748"
                fontFamily="system-ui, sans-serif"
                fontWeight="600"
              >
                {bar.sub}
              </text>
            </g>
          );
        })}

        {/* 設計水圧の内訳（積み上げ表示） */}
        {(() => {
          const i = 2;
          const y = barY(i);
          const x1 = PADDING.left;
          const x2static = scaleX(staticMpa, maxMpa);
          const x2design = scaleX(designMpa, maxMpa);
          return (
            <>
              {/* 静水圧部分（設計水圧バーに重ねて表示） */}
              <rect
                x={x1} y={y}
                width={Math.max(x2static - x1, 2)} height={BAR_H}
                fill="#90cdf4" rx="3" opacity={0.7}
              />
              {/* 境界線 */}
              {x2static > x1 + 2 && (
                <line
                  x1={x2static} y1={y + 2}
                  x2={x2static} y2={y + BAR_H - 2}
                  stroke="white" strokeWidth="1.5"
                />
              )}
              {/* 水撃圧部分ラベル（小さく） */}
              {x2design - x2static > 30 && (
                <text
                  x={(x2static + x2design) / 2} y={y + BAR_H / 2 + 4}
                  fontSize="9" fill="white" textAnchor="middle"
                  fontFamily="system-ui, sans-serif"
                >
                  +水撃圧
                </text>
              )}
            </>
          );
        })()}

        {/* X 軸 */}
        <line
          x1={PADDING.left} y1={H - PADDING.bottom + 4}
          x2={W - PADDING.right + 20} y2={H - PADDING.bottom + 4}
          stroke="#cbd5e0" strokeWidth="1"
        />
        {ticks.map((t) => {
          const x = scaleX(t, maxMpa);
          return (
            <g key={`tick-${t}`}>
              <line x1={x} y1={H - PADDING.bottom + 4} x2={x} y2={H - PADDING.bottom + 8} stroke="#cbd5e0" strokeWidth="1" />
              <text
                x={x} y={H - PADDING.bottom + 18}
                fontSize="10" fill="#a0aec0"
                textAnchor="middle"
                fontFamily="system-ui, sans-serif"
              >
                {t.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* X 軸ラベル */}
        <text
          x={W / 2} y={H - 4}
          fontSize="10" fill="#718096"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
        >
          圧力 [MPa]
        </text>
      </svg>
    </div>
  );
}
