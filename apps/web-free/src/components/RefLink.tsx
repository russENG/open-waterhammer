/**
 * 基準照会ページの特定トピックへジャンプするインラインリンク
 *
 * 使用例:
 *   <RefLink topicId="moc">技術書 §8.4 を参照</RefLink>
 *
 * クリックすると ReferencePage に遷移し、該当トピックの最初の参照を自動的に開く。
 */

import type { ReactNode } from "react";
import { navigateTo } from "../lib/navigation";

interface RefLinkProps {
  /** ReferencePage の TOPICS で定義されている id */
  topicId: string;
  children: ReactNode;
  /** 追加 className */
  className?: string;
}

export function RefLink({ topicId, children, className }: RefLinkProps) {
  return (
    <button
      type="button"
      className={`ref-link${className ? " " + className : ""}`}
      onClick={() => navigateTo("reference", topicId)}
      title="基準照会ページの該当箇所を開く"
    >
      {children}
      <span className="ref-link-icon" aria-hidden="true">↗</span>
    </button>
  );
}
