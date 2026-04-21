/**
 * 基準照会トピックのホバープレビュー付きインラインリンク
 *
 * 使用例:
 *   <RefTooltip topicId="moc">技術書 §8.4</RefTooltip>
 *
 * - ホバー時に 3文書の該当箇所プレビューを表示
 * - クリックで ReferencePage へ遷移（RefLink と同じ動作）
 */

import { useState, useRef, type ReactNode } from "react";
import { getTopic, PDF_LABELS } from "../data/referenceTopics";
import { navigateTo } from "../lib/navigation";

interface RefTooltipProps {
  topicId: string;
  children: ReactNode;
  className?: string;
}

export function RefTooltip({ topicId, children, className }: RefTooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const topic = getTopic(topicId);

  function show() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setOpen(true);
  }
  function hideSoon() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(false), 150);
  }

  return (
    <span
      className="ref-tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocus={show}
      onBlur={hideSoon}
    >
      <button
        type="button"
        className={`ref-link${className ? " " + className : ""}`}
        onClick={() => navigateTo("reference", topicId)}
        title="クリックで基準照会ページを開く"
      >
        {children}
        <span className="ref-link-icon" aria-hidden="true">↗</span>
      </button>
      {open && topic && (
        <span className="ref-tooltip" role="tooltip">
          <span className="ref-tooltip-title">{topic.category} / {topic.title}</span>
          <span className="ref-tooltip-refs">
            {topic.refs.map((r, i) => (
              <span key={i} className="ref-tooltip-ref">
                <span className={`ref-tooltip-badge ref-tooltip-badge--${r.pdfId}`}>
                  {PDF_LABELS[r.pdfId] ?? r.pdfId}
                </span>
                <span className="ref-tooltip-note">{r.note}</span>
                {r.page && <span className="ref-tooltip-page">p.{r.page}</span>}
              </span>
            ))}
          </span>
          <span className="ref-tooltip-hint">クリックで基準照会を開く</span>
        </span>
      )}
    </span>
  );
}
