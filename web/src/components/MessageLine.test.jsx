import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageLine } from './MessageLine'

describe('MessageLine', () => {
  it('renders system message (*** ... ***)', () => {
    render(<MessageLine line="*** Alice joined the chat ***" />)
    expect(screen.getByText('Alice joined the chat')).toBeInTheDocument()
    expect(
      screen.getByText('Alice joined the chat').closest('.line')
    ).toHaveClass('system')
  })

  it('renders chat message [user]: content', () => {
    render(<MessageLine line="[Bob]: Hello everyone" />)
    expect(screen.getByText(/Bob:/)).toBeInTheDocument()
    expect(screen.getByText(/Hello everyone/)).toBeInTheDocument()
    expect(document.querySelector('.line.chat')).toBeInTheDocument()
  })

  it('renders plain line as default', () => {
    render(<MessageLine line="Some plain text" />)
    expect(screen.getByText('Some plain text')).toBeInTheDocument()
  })
})
