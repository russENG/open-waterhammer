import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { PyodideStatusChip } from '../PyodideStatusChip'

type Status = 'idle' | 'loading' | 'ready' | 'error'

let mockStatus: Status = 'idle'
const prefetchPyodideMock = vi.fn()

vi.mock('../../hooks/usePyodideStatus', () => ({
  usePyodideStatus: () => mockStatus,
}))

vi.mock('../../lib/pyodide-bridge', () => ({
  prefetchPyodide: () => prefetchPyodideMock(),
}))

describe('PyodideStatusChip', () => {
  test('renders nothing while idle', () => {
    mockStatus = 'idle'
    const { container } = render(<PyodideStatusChip />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing once the runtime is ready', () => {
    mockStatus = 'ready'
    const { container } = render(<PyodideStatusChip />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows the loading message while the runtime is being fetched', () => {
    mockStatus = 'loading'
    render(<PyodideStatusChip />)
    expect(screen.getByText('Python ランタイム取得中…')).toBeVisible()
  })

  test('shows a short error message with a retry button that re-invokes the prefetch', async () => {
    const user = userEvent.setup()
    mockStatus = 'error'
    render(<PyodideStatusChip />)

    expect(screen.getByRole('status')).toHaveTextContent(/Python/)
    const retry = screen.getByRole('button', { name: '再試行' })
    await user.click(retry)
    expect(prefetchPyodideMock).toHaveBeenCalledTimes(1)
  })
})
