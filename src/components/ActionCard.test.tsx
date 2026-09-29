import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActionCard from './ActionCard'

vi.mock('./ActionCard.css', () => ({}))

const mockAddToast = vi.fn()
const mockCopy = vi.fn()

vi.mock('./ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    removeAllToasts: vi.fn(),
    announce: vi.fn(),
  }),
}))

vi.mock('../hooks/useCopyToClipboard', () => ({
  default: () => ({ copy: mockCopy, copied: false, reset: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'dashboard.copyLink': 'Copy link to this card',
        'dashboard.linkCopied': 'Link copied to clipboard',
      }
      return translations[key] || options?.defaultValue || key
    },
  }),
}))

describe('ActionCard', () => {
  beforeEach(() => {
    mockAddToast.mockClear()
    mockCopy.mockClear()
  })

  it('renders title as an <h2> and children', () => {
    render(<ActionCard title="Test Title">Test Content</ActionCard>)
    const title = screen.getByRole('heading', { level: 2, name: 'Test Title' })
    expect(title).toBeInTheDocument()
    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('applies default classes', () => {
    const { container } = render(<ActionCard title="Test Title">Test Content</ActionCard>)
    const article = container.querySelector('article')
    expect(article).toHaveClass('actionCard')
    expect(article).toHaveClass('actionCard--comfortable')
    expect(article).not.toHaveClass('actionCard--elevated')
  })

  it('applies compact padding modifier', () => {
    const { container } = render(
      <ActionCard title="Test" padding="compact">
        Content
      </ActionCard>
    )
    const article = container.querySelector('article')
    expect(article).toHaveClass('actionCard--compact')
  })

  it('applies elevated modifier', () => {
    const { container } = render(
      <ActionCard title="Test" elevated>
        Content
      </ActionCard>
    )
    const article = container.querySelector('article')
    expect(article).toHaveClass('actionCard--elevated')
  })

  it('renders a copy-link button when shareableLink is provided', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolved(true)

    render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=test">
        Content
      </ActionCard>
    )

    const copyButton = screen.getByRole('button', { name: 'Copy link to this card' })
    expect(copyButton).toBeInTheDocument()

    await user.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('https://example.com/dashboard?widget=test')
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard')
  })

  it('does not render a copy-link button when shareableLink is omitted', () => {
    render(<ActionCard title="Test Title">Content</ActionCard>)

    expect(screen.queryByRole('button', { name: 'Copy link to this card' })).not.toBeInTheDocument()
  })

  it('renders a beta ribbon when isEarlyAccess is true', () => {
    render(
      <ActionCard title="Beta Feature" isEarlyAccess>
        Content
      </ActionCard>
    )
    expect(screen.getByText('BETAC')).toBeInTheDocument()
  })

  it('renders close button when onDismiss is provided', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <ActionCard title="Test" onDismiss={onDismiss}>
        Content
      </ActionCard>
    )
    const closeBtn = screen.getByRole('button', { name: 'Close card' })
    expect(closeBtn).toBeInTheDocument()

    await user.click(closeBtn)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // --- Failure-boundary coverage ---

  it('surfaces an inline retry when copy resolves false and does not toast', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolved(false)

    render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))

    expect(mockCopy).toHaveBeenCalledTimes(1)
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('surfaces the error panel when copy throws and invokes onCopyError', async () => {
    const user = userEvent.setup()
    const failure = new Error('clipboard denied')
    mockCopy.mockRejected(failure)
    const onCopyError = vi.fn()

    render(
      <ActionCard
        title="Test Title"
        shareableLink="https://example.com/dashboard?widget=test"
        onCopyError={onCopyError}
      >
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))

    expect(mockAddToast).not.toHaveBeenCalled()
    expect(onCopyError).toHaveBeenCalledWith(failure)
    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument()
  })

  it('retry after failure can succeed and clears the error panel', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolvedOnce(false).mockResolvedOnce(true)

    render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))
    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument()

    await user.click(screen.getButton('Try again'))

    expect(mockCopy).toHaveBeenCalledTimes(2)
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard')
    await waitFor(() =>
      expect(screen.queryByText("Couldn't copy the link")).not.toBeInTheDocument()
    )
  })

  it('disables the copy button while a copy is in flight and ignores concurrent clicks', async () => {
    const user = userEvent.setup()
    let resolveCopy: ((value: boolean) => void) | undefined
    mockCopy.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve
        })
    )

    render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=test">
        Content
      </ActionCard>
    )

    const copyButton = screen.getByRole('button', { name: 'Copy link to this card' })
    await user.click(copyButton)

    // While in flight the button is disabled and marked busy.
    expect(copyButton).toBeDisabled()
    expect(copyButton).toHaveAttribute('aria-busy', 'true')

    // A concurrent click must not start a second copy.
    await user.click(copyButton)
    expect(mockCopy).toHaveBeenCalledTimes(1)

    resolveCopy?.(true)
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard'))
  })

  it('does not commit a stale copy result after the link changes', async () => {
    const user = userEvent.setup()
    let resolveCopy: ((value: boolean) => void) | undefined
    mockCopy.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve
        })
    )

    const { rerender } = render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=a">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))

    // The target link changes before the in-flight copy resolves.
    rerender(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=b">
        Content
      </ActionCard>
    )

    resolveCopy?.(true)

    // The stale success must not surface a toast for the old link.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('clears a previous error when the shareable link changes', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolved(false)

    const { rerender } = render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=a">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))
    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument()

    rerender(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=b">
        Content
      </ActionCard>
    )

    await waitFor(() =>
      expect(screen.queryByText("Couldn't copy the link")).not.toBeInTheDocument()
    )
  })

  it('does not mutate state after unmount during an in-flight copy', async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveCopy: ((value: boolean) => void) | undefined
    mockCopy.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve
        })
    )

    const { unmount } = render(
      <ActionCard title="Test Title" shareableLink="https://example.com/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getButton('Copy link to this card'))
    unmount()

    resolveCopy?.(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockAddToast).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
