/**
 * 旧 URL fragment（例: `#joukowsky`）を新 HashRouter のライブラリページ URL に変換する。
 *
 * 背景: Stage 7〜8（計算ライブラリページ追加〜notebooks 公開、design-workspace 化以前）の
 * 公開サイトはページ遷移を React state で管理しており、`location.hash` に実際に書き込まれる
 * URL fragment は FormulaCard の `href="#{id}"`（例: `#joukowsky`）だけだった。README・要旨・
 * 外部の議論からはこの形で個別の式が引用されている（docs/roadmap.md 「URL fragment 引用可」）。
 *
 * design-workspace で App 全体が HashRouter（`#/...`）化されたことで、`#joukowsky` は
 * 未知ルートとしてワークスペースにフォールバックしてしまい、外部からの引用リンクが
 * 静かに機能を失う。本モジュールはその橋渡しを行う。
 *
 * 旧アプリはページ名（`about` 等）を URL に書き込んだことは一度もない（ページ遷移は
 * useState のみで管理されていた。dd37b73 / 4b1d601 参照）ため、既知ページ名 → docs ページの
 * マッピング表は設けない。「アンカーIDに一致すればライブラリの該当式へ、それ以外はライブラリ
 * 一覧へ」の2択のみで、過去に実在した URL 形式をすべてカバーする。
 */

import { getFormulaById } from "../data/formulaCatalog";

const LEGACY_ANCHOR_PATTERN = /^#[A-Za-z0-9_-]+$/;

/**
 * @param hash 現在（または初期表示時）の `window.location.hash`
 * @returns 書き換え先の hash。legacy な式アンカーでなければ `null`。
 *   - 既知の式ID（formulaCatalog）に一致: `#/docs/library?topic=<id>`
 *     （LibraryPage 側の initialAnchor 機構が該当カードまでスクロールする）
 *   - アンカーの形はしているが未知のID: `#/docs/library`（一覧にフォールバック）
 */
export function resolveLegacyHash(hash: string): string | null {
  if (!hash || hash.startsWith("#/") || !LEGACY_ANCHOR_PATTERN.test(hash)) return null;
  const id = hash.slice(1);
  return getFormulaById(id) ? `#/docs/library?topic=${encodeURIComponent(id)}` : "#/docs/library";
}
