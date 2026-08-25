import { describe, expect, test } from 'vitest'

import { buildPdfViewUrl } from '../pdf-view-url'

describe('buildPdfViewUrl', () => {
  test('PDF URLにページ指定を付ける', () => {
    expect(buildPdfViewUrl('https://example.com/book.pdf', 31))
      .toBe('https://example.com/book.pdf#page=31')
  })

  test('既存のフラグメントをページ指定で置き換える', () => {
    expect(buildPdfViewUrl('https://example.com/book.pdf#zoom=100', 7))
      .toBe('https://example.com/book.pdf#page=7')
  })

  test('ページ未指定ならURLを変えない', () => {
    expect(buildPdfViewUrl('https://example.com/book.pdf')).toBe('https://example.com/book.pdf')
  })
})
