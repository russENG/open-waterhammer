/**
 * KaTeX 数式レンダリングコンポーネント
 *
 * セキュリティ: tex はコード内テンプレートで組まれる前提だが、
 * 万一不正な値が流入しても catch 節で HTML エスケープしてから挿入する。
 */

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface FormulaProps {
  tex: string;
  display?: boolean;  // true = displaystyle（ブロック）, false = inline
}

/** XSS 防御用 HTML エスケープ */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function Formula({ tex, display = false }: FormulaProps) {
  const html = useMemo(() => {
    try {
      // KaTeX は内部で安全に escape する
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        output: "html",
      });
    } catch {
      // フォールバック表示でも tex を必ずエスケープ
      return `<span style="color:red">${escapeHtml(tex)}</span>`;
    }
  }, [tex, display]);

  return (
    <span
      className={display ? "formula-display" : "formula-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
