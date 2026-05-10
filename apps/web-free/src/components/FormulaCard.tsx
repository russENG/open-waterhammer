/**
 * 計算式カード — formulaCatalog.ts の単一エントリを表示する。
 *
 * Stage 7（Python 移行 §計画）:
 * 結果からソースコードへの追跡経路（数式 → 入力 → GitHub → 基準）を
 * 一画面で提供する基本ブロック。LibraryPage 内のカード表示と、
 * 各 Calculator のインライン参照（detail）の両方で再利用される。
 */

import { Formula } from "./Formula";
import { navigateTo } from "../lib/navigation";
import type { FormulaEntry } from "../data/formulaCatalog";
import { githubUrl } from "../data/formulaCatalog";

interface FormulaCardProps {
  entry: FormulaEntry;
  /** "summary" = タイトル+数式+1行説明 のみ / "detail" = 全項目 */
  variant?: "summary" | "detail";
  /** 入力に値を埋めて表示するための実値（任意。指定があれば「現在の入力値」セクションを追加表示） */
  currentValues?: Record<string, string | number>;
}

export function FormulaCard({ entry, variant = "detail", currentValues }: FormulaCardProps) {
  const url = githubUrl(entry.source.file, entry.source.line);

  if (variant === "summary") {
    return (
      <div className="formula-card formula-card--summary" id={entry.id}>
        <div className="formula-card-head">
          <h3 className="formula-card-title">{entry.title}</h3>
          <a className="formula-card-source" href={url} target="_blank" rel="noreferrer">
            ソース ↗
          </a>
        </div>
        <p className="formula-card-summary">{entry.summary}</p>
        <div className="formula-card-tex">
          <Formula tex={entry.tex} display />
        </div>
      </div>
    );
  }

  return (
    <article className="formula-card" id={entry.id}>
      {/* タイトル & ソースリンク */}
      <header className="formula-card-head">
        <h3 className="formula-card-title">
          {entry.title}
          <a
            className="formula-card-anchor"
            href={`#${entry.id}`}
            aria-label={`${entry.title} へのリンク`}
            title="この式へのリンクをコピー"
          >
            #
          </a>
        </h3>
        <div className="formula-card-actions">
          <a className="formula-card-source" href={url} target="_blank" rel="noreferrer">
            <span aria-hidden="true">⟨ / ⟩</span> ソース ({entry.source.func})
          </a>
        </div>
      </header>

      {/* 1行サマリ */}
      <p className="formula-card-summary">{entry.summary}</p>

      {/* 数式 */}
      <div className="formula-card-tex">
        <Formula tex={entry.tex} display />
      </div>

      {/* 入力 */}
      <div className="formula-card-section">
        <h4 className="formula-card-section-title">入力</h4>
        <table className="formula-card-table">
          <thead>
            <tr>
              <th>記号</th>
              <th>説明</th>
              <th>単位</th>
              {currentValues ? <th>現在値</th> : null}
            </tr>
          </thead>
          <tbody>
            {entry.inputs.map((inp, i) => {
              const key = inp.symbol.replace(/\\\\|\\/g, "");
              const v = currentValues?.[key];
              return (
                <tr key={i}>
                  <td className="formula-card-sym">
                    <Formula tex={inp.symbol} />
                  </td>
                  <td>{inp.description}</td>
                  <td className="formula-card-unit">{inp.unit}</td>
                  {currentValues ? <td className="formula-card-num">{v ?? "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 出力 */}
      <div className="formula-card-section">
        <h4 className="formula-card-section-title">出力</h4>
        <table className="formula-card-table">
          <tbody>
            <tr>
              <td className="formula-card-sym">
                <Formula tex={entry.output.symbol} />
              </td>
              <td>{entry.output.description}</td>
              <td className="formula-card-unit">{entry.output.unit}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 適用条件 */}
      <div className="formula-card-section">
        <h4 className="formula-card-section-title">適用条件</h4>
        <p className="formula-card-text">{entry.applicability}</p>
      </div>

      {/* 補足 */}
      {entry.notes && (
        <div className="formula-card-section formula-card-section--notes">
          <h4 className="formula-card-section-title">補足</h4>
          <p className="formula-card-text">{entry.notes}</p>
        </div>
      )}

      {/* 参考基準 */}
      <div className="formula-card-section">
        <h4 className="formula-card-section-title">準拠基準</h4>
        <ul className="formula-card-refs">
          {entry.references.map((ref, i) => (
            <li key={i}>
              <span>{ref.section}</span>
              {ref.topicId ? (
                <button
                  className="formula-card-ref-link"
                  onClick={() => navigateTo("reference", ref.topicId)}
                >
                  基準照会で見る →
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

// ─── インライン参照（Calculator から呼ぶ用） ────────────────────────────────

interface InlineFormulaRefProps {
  entry: FormulaEntry;
  /** カスタムラベル（既定: "📖 この計算式を見る"） */
  label?: string;
}

/**
 * Calculator の結果近くに置く小さなリンク。クリックで /library の該当 anchor へ遷移。
 */
export function InlineFormulaRef({ entry, label = "📖 この計算式を見る" }: InlineFormulaRefProps) {
  return (
    <button
      className="inline-formula-ref"
      onClick={() => navigateTo("library", entry.id)}
      title={`${entry.title} の数式と実装ソースを開く`}
    >
      {label}
      <span className="inline-formula-ref-id">#{entry.id}</span>
    </button>
  );
}
