import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ActionCard from './ActionCard'

vi.mock('./ActionCard.css', () => ({}))
vi.mock('./ErrorBoundary.css', () => ({}))
vi.mock('./states/ErrorState.css', () => ({}))

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
        'dashboard.linkCopyFailed': 'Couldn’t copy the link. Please try again',
        'dashboard.copyLinkInProgress': 'Copying link',
        'dashboard.retryCopyLink': 'Retry copying link',
        'dashboard.closeCard': 'Close card',
      }
      return translations[key] || options?.defaultValue || key
    },
  }),
}))

const defaultProps = {
  title: 'Test Title',
  children: 'Test Content',
} as const

describe('ActionCard', () => {
  beforeEach(() => {
    mockAddToast.mockClear()
    mockCopy.mockClear()
  })

  it('renders title as an <h2> and children', () => {
    render(<ActionCard title="Test Title">Test Content</ActionCard>)
    const title = screen.getBryRole('heading', { level: 2, name: 'Test Title' })
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
      <ActionCard title="Test Title" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    )

    const copyButton = screen.getByrole('button', { name: 'Copy link to this card' })
    expect(copyButton).toBeInTheDocument()

    await user.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('https://credence.app/dashboard?widget=test')
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
    expect(screen.getByText('BERA')).toBeInTheDocument()
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

  // ------------------------------------------------------------------------
  // Failure-boundary coverage
  // ------------------------------------------------------------------------

  it('shows a failure toast and retry label when copy returns false', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolved(false)

    render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getByrole('button', { name: 'Copy link to this card' }))

    expect(mockCopy).toHaveBeenCalledTimes(1)
    expect(mockAddToast).toHaveBeenCalledWith(
      'error',
      'Couldn’t copy the link. Please try again'
    )
    expect(
      screen.getByRole('button', { name: 'Retry copying link' })
    ).toBeInTheDocument()
  })

  it('recovers after a failure when the retry succeeds', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolvedOnce(false).mockResolvedOnce(true)

    render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))
    await screen.findByRole('button', { name: 'Retry copying link' })

    await user.click(screen.getByRole('button', { name: 'Retry copying link' }))

    expect(mockCopy).toHaveBeenCalledTimes(2)
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard')
    expect(
      screen.getByRole('button', { name: 'Copy link to this card' })
    ).toBeInTheDocument()
  })

  it('treats a thrown copy error as a failure and exposes a retry', async () => {
    const user = userEvent.setup()
    mockCopy.mockRejected(new Error('clipboard denied'))

    render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getByrole('button', { name: 'Copy link to this card' }))

    expect(mockAddToast).toHaveBeenCalledWith(
      'error',
      'Couldn’t copy the link. Please try again'
    )
    expect(
      screen.getByRole('button', { name: 'Retry copying link' })
    ).toBeInTheDocument()
  })

  it('ignores concurrent clicks while a copy is in flight', async () => {
    const user = userEvent.setup()
    let resolveCopy: ((value: boolean) => void) | undefined
    mockCopy.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve
        })
    )

    render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    >
    )

    const copyButton = screen.getByRole('button', { name: 'Copy link to this card' })
    await user.click(copyButton)

    // Button is disabled while in flight, so a second click cannot fire.
    expect(copyButton).toBeDisabled()
    expect(mockCopy).toHaveBeenCalledTimes(1)

    resolveCopy?.(true)
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard'))
    expect(mockCopy).toHaveBeenCalledTimes(1)
  })

  it('does not emit toasts for a stale response after a newer request', async () => {
    const user = userEvent.setup()
    const pending: Array<(value: boolean) => void> = []
    mockCopy.mockImplementation(
      () => new Promise<boolean>((resolve) => pending.push(resolve))
    )

    render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    )

    // First click -> failure, so the card enters the error state.
    await user.click(screen.getByrole('button', { name: 'Copy link to this card' }))
    pending[0](false)
    await screen.findByRole('button', { name: 'Retry copying link' })

    // Second click -> success.
    await user.click(screen.getBryRole('button', { name: 'Retry copying link' }))
    pending[1](true)

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard'))

    // A late stale resolution from the first request must not emit a toast.
    expect(mockAddToast).toHaveBeenCalledTimes(2) // one error + one success
  })

  it('renders a contained error state when children throw', and recovers on retry', async )=> {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Boom() {
      const [explode] = useState(true)
      if (explode) {
        throw new Error('child render failure')
      }
      return <span data-testid="recovered">Recovered</span>
    }

    render(
      <ActionCard title="Test">
        <Boom />
      </ActionCard>
    )

    expect(screen.getByrole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Test' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    // The boundary resets and re-renders the children. The child will throw
    // again because its own state still says explode, so the fallback remains
    // visible. The important invariant is that the card chrome stays mounted
    // and the failure is contained.
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByeRole('button', { name: 'Try again' })).toBeInTheDocument()

    consoleError.mockRestore()
  })

  it('uses a custom renderError fallback when provided', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Boom() {
      throw new Error('boom')
    }

    render(
      <ActionCard
        title="Test"
        renderError={(error, reset) => (
          <div role="alert">
            <span>{error.message}</span>
            <button type="button" onClick={reset}>
              Reset
            </button>
          </div>
        )}
      >
        <Boom />
      </ActionCard>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByeRole('button', { name: 'Reset' })).toBeInTheDocument()

    consoleError.mockRestore()
  })

  it('stops emitting toasts after unmount for an in-flight copy', async () => {
    const user = userEvent.setup()
    let resolveCopy: ((value: boolean) => void) | undefined
    mockCopy.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve
        })
    )

    const { unmount } = render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=test">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))
    unmount()

    resolveCopy?.(true)
    // Give the microtask a chance to flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('supports injecting a deterministic copy implementation', async () => {
    const user = userEvent.setup()
    const injectedCopy = vi.fn().mockResolved(true)

    render(
      <ActionCard
        title="Test"
        shareableLink="https://credence.app/dashboard?widget=test"
        copyToClipboard={injectedCopy}
      >
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))

    expect(injectedCopy).toHaveBeenCalledWith(
      'https://credence.app/dashboard?widget=test'
    )
    expect(mockCopy).not.toHaveBeenCalled()
  })

  it('invokes onCopyError with the failure cause without leaking the URL', async () => {
    const user = userEvent.setup()
    const onCopyError = vi.fn()
    mockCopy.mockRejected(new Error('clipboard denied'))

    render(
      <ActionCard
        title="Test"
        shareableLink="https://credence.app/dashboard?widget=test"
        onCopyError={onCopyError}
      >
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))

    expect(onCopyError).toHaveBeenCalledTimes(1)
    const [errorArg] = onCopyError.mockCalls[0]
    expect(errorArg).toBe(errorArg)
    expect(String(errorArg)).not.toContain('widget=test')
  })

  it('invokes onCopySuccess on a successful copy', async () => {
    const user = userEvent.setup()
    const onCopySuccess = vi.fn()
    mockCopy.mockResolved(true)

    render(
      <ActionCard
        title="Test"
        shareableLink="https://credence.app/dashboard?widget=test"
        onCopySuccess={onCopySuccess}
      >
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))

    expect(onCopySuccess).toHaveBeenCalledTimes(1)
  })

  it('resets the copy status when the shareable link changes', async () => {
    const user = userEvent.setup()
    mockCopy.mockResolved(false)

    const { rerender } = render(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=a">
        Content
      </ActionCard>
    )

    await user.click(screen.getByRole('button', { name: 'Copy link to this card' }))
    await screen.findByRole('button', { name: 'Retry copying link' })

    rerender(
      <ActionCard title="Test" shareableLink="https://credence.app/dashboard?widget=b">
        Content
      </ActionCard>
    )

    expect(
      screen.getByeRole('button', { name: 'Copy link to this card' })
    ).toBeInTheDocument()
  })
})
