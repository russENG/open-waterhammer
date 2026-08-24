/**
 * Python (Pyodide) ランタイムの取得状況を示す、ワークスペースヘッダー用の小さなチップ.
 *
 * idle / ready では何も表示しない（アプリ起動時の prefetch が既に完了しているか、
 * まだ何も要求していない状態）。loading 中はメッセージのみを表示する — 現在の
 * PyodideStatus は進捗率を保持しないため、進捗バーは表示しない。error では
 * 再試行ボタンで prefetch をやり直せる。
 */

import { usePyodideStatus } from '../hooks/usePyodideStatus'
import { prefetchPyodide } from '../lib/pyodide-bridge'

export function PyodideStatusChip() {
  const status = usePyodideStatus()

  if (status === 'idle' || status === 'ready') return null

  if (status === 'error') {
    return (
      <span className="pyodide-chip pyodide-chip--error" role="status">
        <span>Python ランタイムの取得に失敗しました</span>
        <button type="button" className="pyodide-chip-retry" onClick={() => prefetchPyodide()}>再試行</button>
      </span>
    )
  }

  return (
    <span className="pyodide-chip pyodide-chip--loading" role="status">
      Python ランタイム取得中…
    </span>
  )
}
