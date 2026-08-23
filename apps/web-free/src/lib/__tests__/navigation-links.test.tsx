import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { AboutPage } from '../../pages/AboutPage'
import { onNavigate } from '../navigation'

describe('AboutPage links reach the shared navigation bus', () => {
  test('clicking 計算ライブラリ invokes the navigation subscriber with the library page', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    const unsubscribe = onNavigate(handler)

    render(<AboutPage />)
    await user.click(screen.getByRole('link', { name: '計算ライブラリ' }))

    expect(handler).toHaveBeenCalledWith({ page: 'library', topicId: undefined })

    unsubscribe()
  })
})
