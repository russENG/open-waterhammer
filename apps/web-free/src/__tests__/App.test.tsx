import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import App from '../App'

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

describe('legacy formula-anchor URLs stay reachable under the HashRouter', () => {
  test('a bare "#joukowsky" fragment redirects into the library docs page', async () => {
    window.location.hash = '#joukowsky'

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' })).toBeVisible()
    await waitFor(() => expect(window.location.hash).toBe('#/docs/library?topic=joukowsky'))
  })

  test('an anchor-shaped but unknown legacy fragment falls back to the plain library page', async () => {
    window.location.hash = '#not-a-real-formula'

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' })).toBeVisible()
    await waitFor(() => expect(window.location.hash).toBe('#/docs/library'))
  })

  test('an already-routed docs hash is left untouched (no redirect loop)', async () => {
    window.location.hash = '#/docs/library'

    render(<App />)

    expect(await screen.findByRole('heading', { name: '計算ライブラリ' })).toBeVisible()
    expect(window.location.hash).toBe('#/docs/library')
  })
})
