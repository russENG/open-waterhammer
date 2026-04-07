/**
 * シンプルなページ間ナビゲーション機構（カスタムイベント方式）
 *
 * App.tsx は useState ベースのルーティングのため、
 * 子コンポーネントから親 (App) に「基準照会ページの特定トピックを開いてほしい」を伝える手段が無い。
 *
 * グローバル EventTarget を1つ用意し、計算コンポーネントから dispatch、App.tsx で listen する。
 * 外部依存ゼロ・ProviderTreeも不要。
 */

export type AppPage = "about" | "design-flow" | "hydraulic" | "water-hammer" | "reference";

export interface NavigateDetail {
  page: AppPage;
  /** ReferencePage を開く場合に指定するトピックID */
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
