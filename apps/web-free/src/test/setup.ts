import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:test-download'
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

/**
 * localStorage の代替実装。
 *
 * 新しめの Node は Web Storage の `localStorage` を globalThis に
 * 「非列挙の own アクセサ」として先に生やす。`--localstorage-file` を
 * 渡していないと、この getter は undefined を返す。
 * vitest の jsdom 環境はあとから jsdom の window プロパティを globalThis に
 * 載せるが、すでに own プロパティがあるここだけ上書きできない。
 * vitest では window === globalThis なので `window.localStorage` まで
 * 巻き添えで undefined になる（sessionStorage / indexedDB は無事）。
 *
 * アプリは素の `localStorage` を使う（WorkspaceLayout の
 * `owh_recent_workspace`、workspace/indexeddb.ts の旧データ移行）ため、
 * これが無いとテストが Node のバージョン次第で落ちる。
 * URL.createObjectURL / ResizeObserver と同じく、ブラウザにはあるが
 * テスト環境に無い API を埋めている。
 *
 * getItem / setItem / removeItem / clear / key / length のみ。
 * プロパティアクセス（`localStorage.foo = 'x'`）には対応しない。
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { store.set(String(key), String(value)) },
    removeItem: (key: string) => { store.delete(String(key)) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  })
}
