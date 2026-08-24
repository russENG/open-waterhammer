// Cloudflare Web Analytics (cookie-less, no per-visitor identifiers) — opt-in at build time.
//
// The beacon is injected ONLY when VITE_CF_BEACON_TOKEN is set, which is done exclusively by the
// GitHub Pages deploy workflow. Local `vite dev`, `vite build`, `vite preview` and the Playwright
// E2E build therefore stay strictly self-origin: the untouched Content-Security-Policy in
// index.html keeps blocking every external host, and the E2E assertion that no external origin is
// contacted during calculations holds without an exemption.
//
// When the token IS present, two things change together, in this one place:
//   1. the beacon <script> is appended to <body>
//   2. the CSP gains exactly the two hosts that beacon needs — the script host and the endpoint it
//      POSTs page-view records to. Nothing else is widened.
//
// Only anonymous page-level data (URL, referrer, user agent, approximate location derived from IP
// by Cloudflare) is collected. Project data never leaves the browser: calculations run locally in
// Pyodide and workspace state lives in IndexedDB.

const BEACON_SCRIPT_HOST = 'https://static.cloudflareinsights.com'
const BEACON_ENDPOINT_HOST = 'https://cloudflareinsights.com'
const BEACON_SRC = `${BEACON_SCRIPT_HOST}/beacon.min.js`

/** Widens `script-src` and `connect-src` by the beacon hosts, leaving every other directive as-is. */
export function cspWithBeaconHosts(csp: string): string {
  return csp
    .split(';')
    .map((directive) => {
      const trimmed = directive.trim()
      if (trimmed.startsWith('script-src ')) return ` ${trimmed} ${BEACON_SCRIPT_HOST}`
      if (trimmed.startsWith('connect-src ')) return ` ${trimmed} ${BEACON_ENDPOINT_HOST}`
      return directive
    })
    .join(';')
}

// Cloudflare issues beacon tokens as fixed-length hex strings. Requiring an alphanumeric token is
// both a typo check and the reason the value can be inlined into the single-quoted data attribute
// below without an escaping scheme: no quote, angle bracket or backslash can ever reach the HTML.
// A configured-but-malformed token fails the build loudly rather than shipping a broken tag.
const TOKEN_PATTERN = /^[A-Za-z0-9]{8,64}$/

/** Returns the transformed index.html, or the input unchanged when no token is configured. */
export function applyWebAnalytics(html: string, token: string | undefined): string {
  const trimmedToken = token?.trim()
  if (!trimmedToken) return html
  if (!TOKEN_PATTERN.test(trimmedToken)) {
    throw new Error(
      'VITE_CF_BEACON_TOKEN must be 8-64 alphanumeric characters (Cloudflare Web Analytics beacon token).',
    )
  }

  const withCsp = html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/,
    (_match, prefix: string, csp: string, suffix: string) => `${prefix}${cspWithBeaconHosts(csp)}${suffix}`,
  )

  const beacon =
    `    <script defer src="${BEACON_SRC}" ` +
    `data-cf-beacon='{"token": ${JSON.stringify(trimmedToken)}}'></script>\n`

  return withCsp.replace('</body>', `${beacon}  </body>`)
}

export function cloudflareWebAnalytics() {
  return {
    name: 'cloudflare-web-analytics',
    transformIndexHtml(html: string) {
      return applyWebAnalytics(html, process.env.VITE_CF_BEACON_TOKEN)
    },
  } satisfies import('vite').Plugin
}
