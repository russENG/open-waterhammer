/**
 * Pyodide ロード中の通知トースト.
 *
 * アプリ起動時に prefetch でロード開始 → 完了までヘッダ下に表示.
 */

import { usePyodideStatus } from "../hooks/usePyodideStatus"

export function PyodideStatusToast() {
  const status = usePyodideStatus()

  if (status === "ready" || status === "idle") return null

  if (status === "error") {
    return (
      <div className="pyodide-toast pyodide-toast--error">
        計算エンジン（Python）の読込に失敗しました。ネットワーク接続を確認のうえ、ページを再読み込みしてください。
      </div>
    )
  }

  return (
    <div className="pyodide-toast">
      <span className="pyodide-toast-spinner" aria-hidden="true" />
      計算エンジン初期化中…（〜4 秒、初回のみ）
    </div>
  )
}
