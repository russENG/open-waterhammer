/**
 * テスト環境そのものの回帰テスト。
 *
 * `setup.ts` が埋めているブラウザAPIが、実際に使える状態で
 * テストへ渡っていることを確かめる。Node のバージョンが上がったときに、
 * 個々の機能テストが原因不明で落ちる前にここが落ちる。
 */

import { beforeEach, describe, expect, test } from 'vitest'

describe('テスト環境のブラウザAPI', () => {
  describe('localStorage', () => {
    beforeEach(() => { localStorage.clear() })

    test('グローバルとして参照でき、window 経由でも同じものが取れる', () => {
      expect(typeof localStorage).toBe('object')
      expect(window.localStorage).toBe(globalThis.localStorage)
    })

    test('保存・取得・削除・全消去ができる', () => {
      expect(localStorage.getItem('owh_recent_workspace')).toBeNull()

      localStorage.setItem('owh_recent_workspace', '{"tab":"model"}')
      expect(localStorage.getItem('owh_recent_workspace')).toBe('{"tab":"model"}')
      expect(localStorage.length).toBe(1)
      expect(localStorage.key(0)).toBe('owh_recent_workspace')

      localStorage.removeItem('owh_recent_workspace')
      expect(localStorage.getItem('owh_recent_workspace')).toBeNull()

      localStorage.setItem('a', '1')
      localStorage.setItem('b', '2')
      localStorage.clear()
      expect(localStorage.length).toBe(0)
    })
  })

  test('sessionStorage と indexedDB が使える', () => {
    expect(typeof sessionStorage).toBe('object')
    expect(typeof indexedDB).toBe('object')
  })

  test('URL.createObjectURL と ResizeObserver が使える', () => {
    expect(typeof URL.createObjectURL).toBe('function')
    expect(typeof globalThis.ResizeObserver).toBe('function')
  })
})
