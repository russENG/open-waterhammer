/**
 * ポンプ回転速度 N(t) 時系列チャート（SVG）
 * GD² モデル使用時に表示
 */

interface PumpSpeedChartProps {
  /** 回転速度時系列 */
  Nseries: { t: number; N: number }[];
  /** 定格回転速度 N₀ [min⁻¹] */
  N0: number;
  /** 振動周期 T₀ [s]（X軸目盛り用） */
  vibrationPeriod: number;
}

const W = 560;
const H_SVG = 180;
const PAD = { top: 16, right: 24, bottom: 40, left: 64 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H_SVG - PAD.top - PAD.bottom;

export function PumpSpeedChart({ Nseries, N0, vibrationPeriod }: PumpSpeedChartProps) {
  if (Nseries.length < 2) return null;

  const tMax = Nseries[Nseries.length - 1]!.t;
  const Nmax = Math.max(N0 * 1.05, Math.max(...Nseries.map((p) => p.N)));
  const Nmin = Math.min(0, Math.min(...Nseries.map((p) => p.N)));
  const span = Math.max(Nmax - Nmin, 1);
  const yMin = Nmin - span * 0.05;
  const yMax = Nmax + span * 0.08;

  const sx = (t: number) => PAD.left + (t / tMax) * PLOT_W;
  const sy = (n: number) => PAD.top + PLOT_H - ((n - yMin) / (yMax - yMin)) * PLOT_H;

  const points = Nseries.map((p) => `${sx(p.t).toFixed(1)},${sy(p.N).toFixed(1)}`).join(" ");

  // Y 軸目盛（5本）
  const yStep = (yMax - yMin) / 4;
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + yStep * i);

  // X 軸目盛（T₀ 基準 or 4等分）
  const T0 = vibrationPeriod;
  const nXticks = Math.min(6, Math.floor(tMax / T0) + 1);
  const xTicks = T0 > 0 && nXticks >= 2
    ? Array.from({ length: nXticks }, (_, i) => i * T0).filter((t) => t <= tMax * 1.01)
    : Array.from({ length: 5 }, (_, i) => (tMax / 4) * i);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H_SVG}`}
        width="100%"
        style={{ display: "block", maxWidth: W, fontFamily: "system-ui, sans-serif" }}
        aria-label="ポンプ回転速度 N(t)"
      >
        {/* Y グリッド */}
        {yTicks.map((n) => (
          <line key={n} x1={PAD.left} y1={sy(n)} x2={W - PAD.right} y2={sy(n)}
            stroke="#e2e8f0" strokeWidth="1" />
        ))}

        {/* N=0 基準線 */}
        {sy(0) >= PAD.top && sy(0) <= PAD.top + PLOT_H && (
          <line x1={PAD.left} y1={sy(0)} x2={W - PAD.right} y2={sy(0)}
            stroke="#a0aec0" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {/* N₀ 定格線 */}
        <line x1={PAD.left} y1={sy(N0)} x2={W - PAD.right} y2={sy(N0)}
          stroke="#4299e1" strokeWidth="1.2" strokeDasharray="5 3" />
        <text x={W - PAD.right + 3} y={sy(N0) + 4} fontSize="9" fill="#4299e1">N₀</text>

        {/* N(t) 曲線 */}
        <polyline points={points} fill="none" stroke="#805ad5" strokeWidth="2" />

        {/* 軸 */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H}
          stroke="#cbd5e0" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={W - PAD.right} y2={PAD.top + PLOT_H}
          stroke="#cbd5e0" strokeWidth="1" />

        {/* Y 軸ラベル */}
        {yTicks.map((n) => (
          <text key={n} x={PAD.left - 5} y={sy(n) + 4}
            fontSize="10" fill="#718096" textAnchor="end">
            {n.toFixed(0)}
          </text>
        ))}

        {/* X 軸ラベル */}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={PAD.top + PLOT_H + 13}
            fontSize="10" fill="#a0aec0" textAnchor="middle">
            {t.toFixed(2)}
          </text>
        ))}

        {/* 軸タイトル */}
        <text
          x={PAD.left - 50} y={PAD.top + PLOT_H / 2}
          fontSize="10" fill="#718096" textAnchor="middle"
          transform={`rotate(-90, ${PAD.left - 50}, ${PAD.top + PLOT_H / 2})`}
        >
          N [min⁻¹]
        </text>
        <text x={PAD.left + PLOT_W / 2} y={H_SVG - 4}
          fontSize="10" fill="#718096" textAnchor="middle">
          時間 t [s]
        </text>
      </svg>
    </div>
  );
}
