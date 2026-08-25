import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import App from '../App'

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

// LibraryPage is behind React.lazy(); under a full parallel test-suite run the dynamic
// import can take noticeably longer than testing-library's 1000ms findBy default, so these
// wait generously (with headroom under the 10s per-test timeout below) rather than flake.
const FIND_HEADING_TIMEOUT = { timeout: 8000 }
const TEST_TIMEOUT = 10000

describe('site title', () => {
  test('uses the service name in the site header', () => {
    window.location.hash = '#/docs/about'

    render(<App />)

    expect(screen.getByText('Open Waterhammer')).toBeVisible()
    expect(screen.queryByText('設計実務を対象とした農業用パイプライン水撃圧計算機能の公開実装と適用性の考察')).not.toBeInTheDocument()
  })
})

describe('legacy formula-anchor URLs stay reachable under the HashRouter', () => {
  test('a bare "#joukowsky" fragment redirects into the library docs page', async () => {
    window.location.hash = '#joukowsky'

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' }, FIND_HEADING_TIMEOUT)).toBeVisible()
    await waitFor(() => expect(window.location.hash).toBe('#/docs/library?topic=joukowsky'))
  }, TEST_TIMEOUT)

  test('an anchor-shaped but unknown legacy fragment falls back to the plain library page', async () => {
    window.location.hash = '#not-a-real-formula'

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' }, FIND_HEADING_TIMEOUT)).toBeVisible()
    await waitFor(() => expect(window.location.hash).toBe('#/docs/library'))
  }, TEST_TIMEOUT)

  test('an already-routed docs hash is left untouched (no redirect loop)', async () => {
    window.location.hash = '#/docs/library'

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' }, FIND_HEADING_TIMEOUT)).toBeVisible()
    expect(window.location.hash).toBe('#/docs/library')
  }, TEST_TIMEOUT)

  test('the redirect uses history.replaceState, not a pushing hash assignment, so Back cannot loop on the legacy fragment', async () => {
    window.location.hash = '#joukowsky'
    const lengthBeforeMount = window.history.length
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' }, FIND_HEADING_TIMEOUT)).toBeVisible()
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#/docs/library?topic=joukowsky')
    // A pushing `location.hash = target` assignment would leave the legacy `#joukowsky`
    // entry behind in session history, trapping Back into replaying the redirect forever.
    // replaceState corrects the address bar in place instead, so history must not grow.
    expect(window.history.length).toBe(lengthBeforeMount)

    replaceStateSpy.mockRestore()
  }, TEST_TIMEOUT)
})
