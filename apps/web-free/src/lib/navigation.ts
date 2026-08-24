/**
 * ページ間ナビゲーション機構（カスタムイベント方式）
 *
 * アプリ全体はハッシュベースのルーティングで画面を切り替える
 * （App.tsx の hashchange 購読、および Workspace 側の react-router HashRouter）。
 * 計算フォームや参照カードのようにルーターの外側にある深い子コンポーネントから、
 * 「基準照会・計算ライブラリの特定トピックを開いてほしい」と親 (App.tsx) へ伝える手段として、
 * モジュール内に閉じたグローバル EventTarget を1つ用意する。
 *
 * 子コンポーネントは navigateTo() で dispatch し、App.tsx の onNavigate() がそれを受けて
 * window.location.hash を書き換える。外部依存ゼロ・Provider ツリーも不要。
 */

export type AppPage = "about" | "design-flow" | "hydraulic" | "reference" | "library";

export interface NavigateDetail {
  page: AppPage;
  /** ReferencePage を開く場合に指定するトピックID、または LibraryPage の式アンカーID */
  topicId?: string;
}

const bus = new EventTarget();
const EVENT_NAME = "ocd:navigate";

export function navigateTo(page: AppPage, topicId?: string): void {
  bus.dispatchEvent(new CustomEvent<NavigateDetail>(EVENT_NAME, { detail: { page, topicId } }));
}

export function onNavigate(handler: (detail: NavigateDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<NavigateDetail>).detail);
  bus.addEventListener(EVENT_NAME, listener);
  return () => bus.removeEventListener(EVENT_NAME, listener);
}
