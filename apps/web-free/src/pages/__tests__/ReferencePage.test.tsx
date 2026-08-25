import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import { ReferencePage } from '../ReferencePage'

describe('ReferencePage PDFページ遷移', () => {
  test('設計基準の途中ページを開く', async () => {
    const user = userEvent.setup()
    render(<ReferencePage />)

    await user.click(screen.getByTitle('7-9 管体及び継手等の選定'))

    expect(screen.getByTitle('設計基準（本編）')).toHaveAttribute(
      'src',
      'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-67.pdf#page=32',
    )
    expect(screen.getByText('p.32', { selector: '.ref-viewer-page' })).toBeInTheDocument()
  })

  test('技術書の章別PDFの途中ページを開く', async () => {
    const user = userEvent.setup()
    render(<ReferencePage />)

    await user.click(screen.getByTitle('8.4.2 数理モデル（特性曲線法）'))

    expect(screen.getByTitle('技術書（章別）')).toHaveAttribute(
      'src',
      'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-58.pdf#page=31',
    )
    expect(screen.getByText('p.31', { selector: '.ref-viewer-page' })).toBeInTheDocument()
  })
})
