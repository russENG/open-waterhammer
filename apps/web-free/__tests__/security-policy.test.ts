import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const INDEX_HTML = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8')
const HOST_HEADERS = readFileSync(path.resolve(import.meta.dirname, '../public/_headers'), 'utf8')

describe('browser security policy', () => {
  test('keeps the token-free base document self-origin', () => {
    const csp = INDEX_HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ''
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).toContain("connect-src 'self' https://tile.openstreetmap.org")
    expect(csp).toContain("frame-src 'self' blob: https://www.maff.go.jp")
    expect(csp).toContain("form-action 'self'")
    expect(csp).not.toContain('cloudflareinsights.com')
    expect(INDEX_HTML).not.toContain('data-cf-beacon')
  })

  test('does not claim frame-ancestors protection from a meta policy', () => {
    const csp = INDEX_HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ''
    expect(csp).not.toContain('frame-ancestors')
  })

  test('ships real response-header policy for compatible static hosts', () => {
    expect(HOST_HEADERS).toContain("frame-ancestors 'none'")
    expect(HOST_HEADERS).toContain('X-Frame-Options: DENY')
    expect(HOST_HEADERS).toContain('X-Content-Type-Options: nosniff')
    expect(HOST_HEADERS).not.toContain('cloudflareinsights.com')
  })
})
