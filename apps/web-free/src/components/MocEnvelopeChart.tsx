/**
 * MOC 管路縦断圧力包絡線チャート（SVG）
 *
 * 縦軸: 水頭 H [m]
 * 横軸: 管路距離 x [m]（左=上流端, 右=下流端/バルブ）
 * 表示要素:
 *   - 包絡線帯（Hmax〜Hmin の塗りつぶし領域）
 *   - Hmax 線（赤）
 *   - Hmin 線（緑）
 *   - 定常状態線（灰）
 *   - スナップショット線（青太線、スクロール連動）
 */

interface MocEnvelopeChartProps {
  pipeLength: number;
  Hmax: number[];
  Hmin: number[];
  /** 定常状態の水頭プロファイル（初期値） */
  H_steady: number[];
  /** スクロール中のスナップショット水頭（省略可） */
  snapshot?: number[];
  snapshotTime?: number;
}

// ─── レイアウト定数 ────────────────────────────────────────────────────────────

const W = 560;
const H_SVG = 240;
const PAD = { top: 20, right: 56, bottom: 44, left: 72 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H_SVG - PAD.top - PAD.bottom;

// ─── スケール ──────────────────────────────────────────────────────────────────

function sx(x: number, L: number) {
  return PAD.left + (x / L) * PLOT_W;
}

function sy(h: number, hMin: number, hMax: number) {
  return PAD.top + PLOT_H - ((h - hMin) / (hMax - hMin)) * PLOT_H;
}

function polyline(xs: number[], hs: number[], L: number, hMin: number, hMax: number): string {
  return xs.map((x, i) => `${sx(x, L).toFixed(1)},${sy(hs[i]!, hMin, hMax).toFixed(1)}`).join(" ");
}

// ─── コンポーネント ────────────────────────────────────────────────────────────

export function MocEnvelopeChart({
  pipeLength: L,
  Hmax,
  Hmin,
  H_steady,
  snapshot,
  snapshotTime,
}: MocEnvelopeChartProps) {
  const N = Hmax.length - 1;
  const xs = Array.from({ length: N + 1 }, (_, i) => (i / N) * L);

  // Y 範囲（余白 10%）
  const allVals = [...Hmax, ...Hmin, ...H_steady];
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const span = Math.max(rawMax - rawMin, 1);
  const hMin = rawMin - span * 0.1;
  const hMax = rawMax + span * 0.12;

  // 包絡線の塗りつぶし polygon（Hmax 右→左、Hmin 左→右 で閉じる）
  const topPts = xs.map((x, i) => `${sx(x, L).toFixed(1)},${sy(Hmax[i]!, hMin, hMax).toFixed(1)}`).join(" ");
  const botPts = [...xs].reverse().map((x, i) => {
    const ri = N - i;
    return `${sx(x, L).toFixed(1)},${sy(Hmin[ri]!, hMin, hMax).toFixed(1)}`;
  }).join(" ");
  const fillPts = `${topPts} ${botPts}`;

  // Y 軸目盛
  const yTick = (hMax - hMin) / 4;
  const yTicks = Array.from({ length: 5 }, (_, i) => hMin + yTick * i);

  // X 軸目盛（4等分）
  const xTicks = Array.from({ length: 5 }, (_, i) => (L / 4) * i);

  // 負圧ゾーン（Hmin < 0）があれば強調
  const hasNegative = Hmin.some((h) => h < 0);
  const zeroY = sy(0, hMin, hMax);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H_SVG}`}
        width="100%"
        style={{ display: "block", maxWidth: W, fontFamily: "system-ui, sans-serif" }}
        aria-label="管路縦断圧力包絡線図"
      >
        {/* Y グリッド */}
        {yTicks.map((h) => {
          const y = sy(h, hMin, hMax);
          return (
            <line key={h} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke="#e2e8f0" strokeWidth="1" />
          );
        })}

        {/* 負圧ゾーン（H < 0）赤塗り */}
        {hasNegative && zeroY < PAD.top + PLOT_H && (
          <rect
            x={PAD.left} y={zeroY}
            width={PLOT_W} height={PAD.top + PLOT_H - zeroY}
            fill="#fff5f5" opacity="0.7"
          />
        )}

        {/* 包絡線帯（塗りつぶし） */}
        <polygon points={fillPts} fill="#bee3f8" opacity="0.45" />

        {/* 定常状態線 */}
        <polyline
          points={polyline(xs, H_steady, L, hMin, hMax)}
          fill="none" stroke="#a0aec0" strokeWidth="1.5" strokeDasharray="5 3"
        />

        {/* Hmax 線 */}
        <polyline
          points={polyline(xs, Hmax, L, hMin, hMax)}
          fill="none" stroke="#e53e3e" strokeWidth="2"
        />

        {/* Hmin 線 */}
        <polyline
          points={polyline(xs, Hmin, L, hMin, hMax)}
          fill="none" stroke="#276749" strokeWidth="2"
        />

        {/* H=0 基準線（負圧可視化） */}
        {zeroY >= PAD.top && zeroY <= PAD.top + PLOT_H && (
          <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
            stroke="#fc8181" strokeWidth="1" strokeDasharray="2 2" />
        )}

        {/* スナップショット線 */}
        {snapshot && (
          <polyline
            points={polyline(xs, snapshot, L, hMin, hMax)}
            fill="none" stroke="#3a86ff" strokeWidth="2.5" opacity="0.9"
          />
        )}

        {/* 軸 */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H}
          stroke="#cbd5e0" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={W - PAD.right} y2={PAD.top + PLOT_H}
          stroke="#cbd5e0" strokeWidth="1" />

        {/* Y 軸ラベル */}
        {yTicks.map((h) => {
          const y = sy(h, hMin, hMax);
          return (
            <text key={h} x={PAD.left - 6} y={y + 4} fontSize="10" fill="#718096" textAnchor="end">
              {h.toFixed(0)}
            </text>
          );
        })}

        {/* X 軸ラベル */}
        {xTicks.map((x) => (
          <text key={x} x={sx(x, L)} y={PAD.top + PLOT_H + 14}
            fontSize="10" fill="#a0aec0" textAnchor="middle">
            {x.toFixed(0)}
          </text>
        ))}

        {/* 端点ラベル */}
        <text x={PAD.left} y={PAD.top + PLOT_H + 28} fontSize="9" fill="#718096" textAnchor="middle">
          上流端
        </text>
        <text x={PAD.left + PLOT_W} y={PAD.top + PLOT_H + 28} fontSize="9" fill="#718096" textAnchor="middle">
          バルブ
        </text>

        {/* スナップショット時刻 */}
        {snapshot && snapshotTime !== undefined && (
          <text x={PAD.left + PLOT_W / 2} y={PAD.top - 6}
            fontSize="11" fill="#3a86ff" textAnchor="middle" fontWeight="600">
            t = {snapshotTime.toFixed(3)} s
          </text>
        )}

        {/* 軸タイトル */}
        <text
          x={PAD.left - 56} y={PAD.top + PLOT_H / 2}
          fontSize="10" fill="#718096" textAnchor="middle"
          transform={`rotate(-90, ${PAD.left - 56}, ${PAD.top + PLOT_H / 2})`}
        >
          水頭 H [m]
        </text>
        <text x={PAD.left + PLOT_W / 2} y={H_SVG - 4}
          fontSize="10" fill="#718096" textAnchor="middle">
          管路距離 x [m]
        </text>

        {/* 凡例 */}
        <g>
          {[
            { color: "#e53e3e", label: "Hmax" },
            { color: "#276749", label: "Hmin" },
            { color: "#a0aec0", label: "定常", dash: "5 3" },
            ...(snapshot ? [{ color: "#3a86ff", label: `t=${(snapshotTime ?? 0).toFixed(2)}s` }] : []),
          ].map((leg, i) => (
            <g key={leg.label} transform={`translate(${PAD.left + i * 90}, ${PAD.top - 8})`}>
              <line x1={0} y1={0} x2={18} y2={0} stroke={leg.color} strokeWidth="2"
                strokeDasharray={leg.dash ?? ""} />
              <text x={22} y={4} fontSize="10" fill="#4a5568">{leg.label}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
