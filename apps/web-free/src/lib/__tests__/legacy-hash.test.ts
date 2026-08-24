import { describe, expect, test } from 'vitest'

import { resolveLegacyHash } from '../legacy-hash'

describe('resolveLegacyHash', () => {
  test('maps a known formula-anchor hash (e.g. #joukowsky) to a topic-scoped library link', () => {
    expect(resolveLegacyHash('#joukowsky')).toBe('#/docs/library?topic=joukowsky')
  })

  test('resolves other catalog ids the same way', () => {
    expect(resolveLegacyHash('#allievi-close')).toBe('#/docs/library?topic=allievi-close')
    expect(resolveLegacyHash('#hazen-williams')).toBe('#/docs/library?topic=hazen-williams')
  })

  test('falls back to the plain library page for an anchor-shaped but unknown id', () => {
    expect(resolveLegacyHash('#not-a-real-formula')).toBe('#/docs/library')
  })

  test('leaves already-routed hashes (starting with #/) alone', () => {
    expect(resolveLegacyHash('#/docs/library')).toBeNull()
    expect(resolveLegacyHash('#/docs/library?topic=joukowsky')).toBeNull()
    expect(resolveLegacyHash('#/')).toBeNull()
    expect(resolveLegacyHash('#/projects/p1/cases/c1/overview')).toBeNull()
  })

  test('leaves empty or bare-hash values alone', () => {
    expect(resolveLegacyHash('')).toBeNull()
    expect(resolveLegacyHash('#')).toBeNull()
  })

  test('leaves hashes that do not look like a bare anchor id alone', () => {
    expect(resolveLegacyHash('#joukowsky?topic=x')).toBeNull()
    expect(resolveLegacyHash('#foo bar')).toBeNull()
    expect(resolveLegacyHash('#foo/bar')).toBeNull()
  })
})
