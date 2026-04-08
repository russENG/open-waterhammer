/**
 * MOC 時系列水頭チャート（SVG）
 * 下流端（バルブ）の水頭 H(t) を時間軸で表示
 */

interface MocTimeChartProps {
  downstreamH: { t: number; H: number }[];
  H0: number;          // 初期水頭（基準線）
  HR: number;          // 上流貯水槽水頭
  vibrationPeriod: number; // T₀ [s]（周期マーク用）
}

// ─── レイアウト定数 ────────────────────────────────────────────────────────────

const W = 560;
const H_SVG = 260;
const PAD = { top: 20, right: 50, bottom: 44, left: 72 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H_SVG - PAD.top - PAD.bottom;

// ─── スケール ──────────────────────────────────────────────────────────────────

function scaleX(t: number, tMax: number): number {
  return PAD.left + (t / tMax) * PLOT_W;
}

function scaleY(h: number, hMin: number, hMax: number): number {
  return PAD.top + PLOT_H - ((h - hMin) / (hMax - hMin)) * PLOT_H;
}

// ─── コンポーネント ────────────────────────────────────────────────────────────

export function MocTimeChart({ downstreamH, H0, HR, vibrationPeriod }: MocTimeChartProps) {
  if (downstreamH.length < 2) return null;

  const tMax = downstreamH[downstreamH.length - 1]!.t;
  const Hvals = downstreamH.map((p) => p.H);
  const rawMin = Math.min(...Hvals);
  const rawMax = Math.max(...Hvals);

  // Y 軸余白（10%）
  const span = Math.max(rawMax - rawMin, 1);
  const hMin = rawMin - span * 0.1;
  const hMax = rawMax + span * 0.1;

  // データを最大 400 点にダウンサンプリング
  const step = Math.max(1, Math.floor(downstreamH.length / 400));
  const pts = downstreamH
    .filter((_, i) => i % step === 0)
    .map((p) => `${scaleX(p.t, tMax).toFixed(1)},${scaleY(p.H, hMin, hMax).toFixed(1)}`)
    .join(" ");

  // X 軸目盛（T₀ 単位）
  const nPeriods = Math.floor(tMax / vibrationPeriod);
  const xTicks = Array.from({ length: nPeriods + 1 }, (_, i) => i * vibrationPeriod).filter(
    (t) => t <= tMax,
  );

  // Y 軸目盛（5分割）
  const yTick = (hMax - hMin) / 4;
  const yTicks = Array.from({ length: 5 }, (_, i) => hMin + yTick * i);

  const refLines = [
    { h: H0,  color: "#718096", dash: "4 3", label: `H₀ = ${H0.toFixed(1)} m` },
    { h: HR,  color: "#3a86ff", dash: "4 3", label: `HR = ${HR.toFixed(1)} m` },
    { h: rawMax, color: "#e53e3e", dash: "3 2", label: `Hmax = ${rawMax.toFixed(1)} m` },
    { h: rawMin, color: "#276749", dash: "3 2", label: `Hmin = ${rawMin.toFixed(1)} m` },
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H_SVG}`}
        width="100%"
        style={{ display: "block", maxWidth: W, fontFamily: "system-ui, sans-serif" }}
        aria-label="水頭時系列チャート"
      >
        {/* グリッド（Y） */}
        {yTicks.map((h) => {
          const y = scaleY(h, hMin, hMax);
          return (
            <line key={h} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke="#e2e8f0" strokeWidth="1" />
          );
        })}

        {/* 参照線 */}
        {refLines.map((rl) => {
          const y = scaleY(rl.h, hMin, hMax);
          if (y < PAD.top || y > PAD.top + PLOT_H) return null;
          return (
            <g key={rl.label}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke={rl.color} strokeWidth="1.2" strokeDasharray={rl.dash} />
              <text x={W - PAD.right + 4} y={y + 4} fontSize="9" fill={rl.color}>
                {rl.label}
              </text>
            </g>
          );
        })}

        {/* T₀ 周期縦線 */}
        {xTicks.filter((t) => t > 0).map((t) => {
          const x = scaleX(t, tMax);
          return (
            <g key={t}>
              <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + PLOT_H}
                stroke="#e2e8f0" strokeWidth="1" strokeDasharray="2 2" />
              <text x={x} y={PAD.top + PLOT_H + 14} fontSize="9" fill="#a0aec0" textAnchor="middle">
                {`${(t / vibrationPeriod).toFixed(0)}T₀`}
              </text>
            </g>
          );
        })}

        {/* 水頭曲線 */}
        <polyline
          points={pts}
          fill="none"
          stroke="#3a86ff"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 軸 */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H}
          stroke="#cbd5e0" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={W - PAD.right} y2={PAD.top + PLOT_H}
          stroke="#cbd5e0" strokeWidth="1" />

        {/* Y 軸目盛ラベル */}
        {yTicks.map((h) => {
          const y = scaleY(h, hMin, hMax);
          return (
            <text key={h} x={PAD.left - 6} y={y + 4} fontSize="10" fill="#718096" textAnchor="end">
              {h.toFixed(0)}
            </text>
          );
        })}

        {/* X 軸 tMax ラベル */}
        <text x={W - PAD.right} y={PAD.top + PLOT_H + 14} fontSize="9" fill="#a0aec0" textAnchor="middle">
          {tMax.toFixed(1)}s
        </text>

        {/* 軸ラベル */}
        <text x={PAD.left - 52} y={PAD.top + PLOT_H / 2} fontSize="10" fill="#718096"
          textAnchor="middle" transform={`rotate(-90, ${PAD.left - 52}, ${PAD.top + PLOT_H / 2})`}>
          水頭 H [m]
        </text>
        <text x={PAD.left + PLOT_W / 2} y={H_SVG - 4} fontSize="10" fill="#718096" textAnchor="middle">
          時間 t [s]
        </text>
      </svg>
    </div>
  );
}
