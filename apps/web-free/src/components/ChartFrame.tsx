/**
 * チャート（SVG）に PNG / SVG エクスポートボタンを付与する共通ラッパー
 *
 * 使用例:
 *   <ChartFrame title="管路縦断包絡線" filename="envelope">
 *     <MocEnvelopeChart ... />
 *   </ChartFrame>
 */

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { downloadPng, downloadSvg } from "../utils/svgExport";

interface ChartFrameProps {
  title?: string;
  filename: string;
  children: ReactNode;
}

export function ChartFrame({ title, filename, children }: ChartFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"png" | "svg" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function findSvg(): SVGSVGElement | null {
    return ref.current?.querySelector("svg") ?? null;
  }

  async function handlePng() {
    const svg = findSvg();
    if (!svg) return;
    setBusy("png");
    setError(null);
    try {
      await downloadPng(svg, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PNG 出力に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  function handleSvg() {
    const svg = findSvg();
    if (!svg) return;
    setBusy("svg");
    setError(null);
    try {
      downloadSvg(svg, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "SVG 出力に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="chart-frame">
      <div className="chart-frame-header">
        {title && <span className="chart-frame-title">{title}</span>}
        <div className="chart-frame-actions">
          <button
            type="button"
            className="chart-frame-btn"
            onClick={handlePng}
            disabled={busy !== null}
            title="PNG 画像として保存"
          >
            {busy === "png" ? "…" : "PNG"}
          </button>
          <button
            type="button"
            className="chart-frame-btn"
            onClick={handleSvg}
            disabled={busy !== null}
            title="SVG ベクター画像として保存"
          >
            {busy === "svg" ? "…" : "SVG"}
          </button>
        </div>
      </div>
      <div ref={ref} className="chart-frame-body">
        {children}
      </div>
      {error && <div className="chart-frame-error">{error}</div>}
    </div>
  );
}
