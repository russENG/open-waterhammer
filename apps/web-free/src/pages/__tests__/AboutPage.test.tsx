import {
  SOFTWARE_DISCLAIMER,
  SOFTWARE_LICENSE_URL,
  SOFTWARE_SOURCE_URL,
} from '@open-waterhammer/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { AboutPage } from '../AboutPage'

describe('AboutPage license and warranty notice', () => {
  test('publishes the full disclaimer with license and source links', () => {
    render(<AboutPage />)

    expect(screen.getByRole('heading', { name: 'ライセンス・無保証' })).toBeVisible()
    expect(screen.getByText(SOFTWARE_DISCLAIMER)).toBeVisible()
    expect(screen.getByRole('link', { name: 'AGPL-3.0 ライセンス全文' })).toHaveAttribute('href', SOFTWARE_LICENSE_URL)
    expect(screen.getByRole('link', { name: 'ソースコード' })).toHaveAttribute('href', SOFTWARE_SOURCE_URL)
  })
})
