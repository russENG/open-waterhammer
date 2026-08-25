import { describe, expect, test } from 'vitest'

import { isEmbedded } from '../embed-protection'

describe('embed protection', () => {
  test('allows a top-level browsing context', () => {
    const topLevel = {} as Window
    expect(isEmbedded(topLevel, topLevel)).toBe(false)
  })

  test('blocks a framed browsing context before the workspace initializes', () => {
    expect(isEmbedded({} as Window, {} as Window)).toBe(true)
  })
})
