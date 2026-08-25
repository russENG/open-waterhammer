import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { applyWebAnalytics, cspWithBeaconHosts } from '../web-analytics'

const INDEX_HTML = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8')

describe('web analytics injection', () => {
  test('leaves index.html byte-identical when no token is configured', () => {
    expect(applyWebAnalytics(INDEX_HTML, undefined)).toBe(INDEX_HTML)
    expect(applyWebAnalytics(INDEX_HTML, '')).toBe(INDEX_HTML)
    expect(applyWebAnalytics(INDEX_HTML, '   ')).toBe(INDEX_HTML)
  })

  test('shipped index.html limits scripts and connections while allowing only official and local PDF frames', () => {
    const csp = INDEX_HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1]
    expect(csp).toBeDefined()
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-src 'self' blob: https://www.maff.go.jp")
    expect(csp).not.toContain('frame-src https:')
    expect(csp).not.toContain('cloudflareinsights.com')
  })

  test('appends the beacon inside <body> when a token is configured', () => {
    const html = applyWebAnalytics(INDEX_HTML, 'abc123token')

    expect(html).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"')
    expect(html).toContain('data-cf-beacon=\'{"token": "abc123token"}\'')
    expect(html.indexOf('beacon.min.js')).toBeLessThan(html.indexOf('</body>'))
    expect(html).toContain('defer')
  })

  test('widens exactly the two beacon hosts and nothing else', () => {
    const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none';"
    const widened = cspWithBeaconHosts(csp)

    expect(widened).toContain("script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com")
    expect(widened).toContain("connect-src 'self' https://cloudflareinsights.com")
    // untouched directives survive verbatim
    expect(widened).toContain("default-src 'self'")
    expect(widened).toContain("object-src 'none'")
    // the script host is not silently granted connect access, nor vice versa
    expect(widened).not.toContain("connect-src 'self' https://static.cloudflareinsights.com")
  })

  test('a configured token widens the shipped policy for both beacon phases', () => {
    const html = applyWebAnalytics(INDEX_HTML, 'abc123token')
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ''

    expect(csp).toContain('script-src')
    expect(csp).toContain('https://static.cloudflareinsights.com')
    expect(csp).toContain('https://cloudflareinsights.com')
    expect(csp).not.toContain('unsafe-eval;')
  })

  test('rejects a malformed token instead of injecting it into the page', () => {
    expect(() => applyWebAnalytics(INDEX_HTML, 'evil"}\'><script>alert(1)</script>')).toThrow(
      /VITE_CF_BEACON_TOKEN/,
    )
    expect(() => applyWebAnalytics(INDEX_HTML, 'short')).toThrow(/VITE_CF_BEACON_TOKEN/)
  })
})
