/**
 * 計算ライブラリページ — 全計算式のカタログを一覧表示する。
 *
 * Stage 7（Python 移行 §計画）:
 * 「計算ライブラリ層として整理」「個別計算ロジックが追える」という
 * 移行動機を物理的に体現するページ。各カードは数式・入出力・適用条件・
 * GitHub ソースリンク・基準照会への深リンクを備える。
 *
 * URL fragment（#joukowsky 等）で個別の式に直接到達できる。要旨や
 * README、外部議論から `公開URL/#joukowsky` で引用可能。
 */

import { useEffect, useState } from "react";
import {
  FORMULA_CATALOG,
  CATEGORY_META,
  type FormulaCategory,
  type FormulaEntry,
} from "../data/formulaCatalog";
import { FormulaCard } from "../components/FormulaCard";

interface LibraryPageProps {
  /** 初期表示でスクロールする式 ID（ナビゲーション経由） */
  initialAnchor?: string;
}

const SORTED_CATEGORIES: FormulaCategory[] = (
  Object.keys(CATEGORY_META) as FormulaCategory[]
).sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order);

export function LibraryPage({ initialAnchor }: LibraryPageProps) {
  const [filter, setFilter] = useState<FormulaCategory | "all">("all");
  const [query, setQuery] = useState("");

  // initialAnchor 指定時はその式のカテゴリにフィルタを合わせ、スクロール
  useEffect(() => {
    if (!initialAnchor) return;
    const target = FORMULA_CATALOG.find(f => f.id === initialAnchor);
    if (target) setFilter(target.category);
    // DOM がレンダされた後にスクロール
    requestAnimationFrame(() => {
      const el = document.getElementById(initialAnchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [initialAnchor]);

  // フィルタ＋検索の適用
  const filteredEntries: FormulaEntry[] = FORMULA_CATALOG.filter(f => {
    if (filter !== "all" && f.category !== filter) return false;
    if (query.trim() === "") return true;
    const q = query.toLowerCase();
    return (
      f.title.toLowerCase().includes(q) ||
      f.summary.toLowerCase().includes(q) ||
      f.id.includes(q) ||
      f.source.func.toLowerCase().includes(q)
    );
  });

  // カテゴリでグループ化（フィルタ適用後）
  const groupedByCategory = new Map<FormulaCategory, FormulaEntry[]>();
  for (const entry of filteredEntries) {
    if (!groupedByCategory.has(entry.category)) groupedByCategory.set(entry.category, []);
    groupedByCategory.get(entry.category)!.push(entry);
  }

  return (
    <div className="library-page">
      {/* ヘッダー */}
      <section className="library-hero">
        <h1 className="library-title">計算ライブラリ</h1>
        <p className="library-lead">
          本 OSS が実装する計算式のカタログ。各エントリは数式・入出力・適用条件・
          ソースコード位置・準拠基準を一覧する。
        </p>
        <p className="library-lead-sub">
          外部から特定の式を引用する場合は <code>#{"{式ID}"}</code> アンカーをご利用ください
          （例: <code>{"#joukowsky"}</code>）。
        </p>
      </section>

      {/* フィルタ＆検索 */}
      <section className="library-filters">
        <div className="library-search">
          <input
            type="search"
            className="input"
            placeholder="式名・関数名で検索"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="library-cat-filters">
          <button
            className={`library-cat-btn${filter === "all" ? " library-cat-btn--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            すべて ({FORMULA_CATALOG.length})
          </button>
          {SORTED_CATEGORIES.map(cat => {
            const count = FORMULA_CATALOG.filter(f => f.category === cat).length;
            return (
              <button
                key={cat}
                className={`library-cat-btn${filter === cat ? " library-cat-btn--active" : ""}`}
                onClick={() => setFilter(cat)}
              >
                {CATEGORY_META[cat].label} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* 結果一覧 */}
      <section className="library-results">
        {filteredEntries.length === 0 ? (
          <p className="library-empty">該当する計算式が見つかりません。</p>
        ) : (
          SORTED_CATEGORIES.filter(cat => groupedByCategory.has(cat)).map(cat => (
            <section key={cat} className="library-cat-group">
              <h2 className="library-cat-title">{CATEGORY_META[cat].label}</h2>
              <p className="library-cat-desc">{CATEGORY_META[cat].description}</p>
              <div className="library-cards">
                {groupedByCategory.get(cat)!.map(entry => (
                  <FormulaCard key={entry.id} entry={entry} variant="detail" />
                ))}
              </div>
            </section>
          ))
        )}
      </section>

      {/* フッター注記 */}
      <section className="library-footnote">
        <p>
          計算実装の単一の真理源は <code>packages/core-py/open_waterhammer/</code>（Python）。
          ブラウザでは Pyodide 経由で同じ <code>.py</code> を実行している。
        </p>
        <p>
          定常流網計算は <code>epanet-js</code>（米国 EPA EPANET の WASM 移植、MIT）に委譲。
          自前実装と数値一致を検証済み。
        </p>
      </section>
    </div>
  );
}
