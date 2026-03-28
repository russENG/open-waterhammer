/**
 * KaTeX 数式レンダリングコンポーネント
 */

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface FormulaProps {
  tex: string;
  display?: boolean;  // true = displaystyle（ブロック）, false = inline
}

export function Formula({ tex, display = false }: FormulaProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return `<span style="color:red">${tex}</span>`;
    }
  }, [tex, display]);

  return (
    <span
      className={display ? "formula-display" : "formula-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
