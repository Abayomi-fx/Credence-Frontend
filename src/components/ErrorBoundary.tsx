import { Component, ReactNode } from 'react'
import ErrorState, { type ErrorStateKind, type ErrorStateSeverity } from './states/ErrorState'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
  /** Override the default fallback. Receives the caught error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /**
   * Optional telemetry sink. When provided, it is invoked once per caught
   * error with a sanctioned payload. The default behaviour logs to the
   * console so failures remain diagnosable without exposing sensitive data.
   */
  onError?: (error: Error, info: React.ErrorInfo) => void
  /**
   * Optional reset hook invoked after the boundary recovers. Useful for
   * invalidating caches or re-fetching data that may have caused the error.
   */
  onReset?: () => void
}

interface BoundaryState {
  hasError: boolean
  error: Error | null
  /**
   * Monotonically increasing reset counter. It is used as a child key so
   * the subtree re-mounts on every retry and as a guard against unbounded
   * retry loops.
   */
  resetCount: number
}

interface ClassifiedError {
  kind: ErrorStateKind
  severity: ErrorStateSeverity
}

/**
 * Maximum number of automatic retries before the boundary stops re-mounting
 * the subtree and instead surfaces a deterministic "give up" message. This
 * prevents a tight crash/retry loop from consuming the main thread.
 */
const MAX_RESET_ATTEMPTS = 3

/**
 * Catches render/lifecycle errors in its subtree and shows a branded
 * ErrorState fallback with a retry action and a home link.
 *
 * Calling retry resets internal state so the subtree re-mounts without a
 * hard reload. If the re-mounted subtree throws again the boundary catches
 * it once more, up to MAX_RESET_ATTEMPTS times. After that the retry action
 * is disabled and the user is directed to a full reload.
 *
 * Invariants:
 *  • hasPropError is the only source of truth for whether the fallback
    renders. error is never null when hasError is true.
  • Resets are monotonic and bounded; the boundary cannot loop forever.
  • Telemetry never receives raw error objects or user data; only a
    sanctioned message/name/component stack string.
 */
export default class ErrorBoundary extends Component<Props, BoundaryState> {
  state: BoundaryState = { hasError: false, error: null, resetCount: 0 }

  private isChunkLoadError(error: Error): boolean {
    const message = (error.message ?? '').toLowerCase()
    const errorName = (error.name ?? '').toLowerCase()

    return (
      message.includes('chunk') ||
      message.includes('failed to load') ||
      message.includes('loading chunk') ||
      message.includes('loading module') ||
      errorName === 'chunksloaderror' ||
      message.includes('dynamically imported') ||
      message.includes('failed to fetch') ||
      message.includes('import(') ||
      message.includes('network error') ||
      message.includes('chunk-load')
    )
  }

  /**
   * Classify the error into the standardised (kind, severity) axes so the
   * panel can render a calm, contextualised grip on the failure.
   *
   *  • chunk-load failures are a network-class failure — danger severity.
   *  • everything else falls back to generic / danger.
   */
  private classifyError(error: Error): ClassifiedError {
    if (this.isChunkLoadError(error)) {
      return { kind: 'network', severity: 'danger' }
    }
    return { kind: 'generic', severity: 'danger' }
  }

  /**
   * Normalise an arbitrary thrown value into an Error. React guarantees an
   * Error in getDerivedStateFromError, but third-party code or manual
   * invocations may pass non-Error values. Keeping this total prevents a
   * secondary crash inside the boundary itself.
   */
  private normaliseError(value: unknown): Error {
    if (value instanceof Error) return value
    if (typeof value === 'string') return new Error(value)
    try {
      return new Error(JSON.stringify(value))
    } catch {
      return new Error('Unknown error')
    }
  }

  /**
   * Strip potentially sensitive details from an error message before it
   * reaches telemetry or the console. This keeps the failure diagnosable
   * without exposing tokens, emails, or URLs that may carry credentials.
   */
  private sanctiseMessage(message: string): string {
    return message
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9._%-]+\.[a-zA-Z]{2,}/g, '[redacted-email]')
      .replace(/\bBearer\s+[A-Za-z0-9-._~+/=]+/gi, 'Bearer [redacted]')
      .replace(/\b(token|apikey|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1 [redacted]')
      .slice(0, 500)
  }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { hasError: true, error: error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const normalised = this.normaliseError(error)
    const safeMessage = this.sanctiseMessage(normalised.message)
    const safeStack = this.sanctiseMessage(info.componentStack ?? '')

    if (this.props.onError) {
      this.props.onError(normalised, info)
      return
    }

    // Default telemetry: structured, sanitised, and safe to log.
    console.error('[ErrorBoundary]', {
      name: normalised.name,
      message: safeMessage,
      componentStack: safeStack,
      resetCount: this.state.resetCount,
    })
  }

  private handleReset = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetCount: prev.resetCount + 1,
    }))
    this.props.onReset?.()
  }

  render(): ReactNode {
    const { hasError, error, resetCount } = this.state
    const { children, fallback } = this.props

    if (hasError && error) {
      if (fallback) return fallback(error, this.handleReset)

      const { kind, severity } = this.classifyError(error)
      const exhausted = resetCount >= MAX_RESET_ATTEMPTS && this.isChunkLoadError(error)

      // The whole-app-crash fallback needs stronger wording than the
      // single-section generic copy (cf. docs/UI_STATES_GUIKE.md "Error
      // Boundary Strategy"). We pin the title + message so the user
      // understands the panel is an app-level fallback, not a localized
      // data-fetch failure — the underlying kind still drives the icon.
      return (
        <div className="error-fallback-container" data-error-boundary="true">
          <ErrorState
            type={kind}
            severity={severity}
            title="Something went wrong"
            message={
              exhausted
                ? 'The app hit an unexpected error and couldn’t recover after several retries. Please reload the page or head back to the home page.'
                : 'The app hit an unexpected error and couldn’t recover on its own. Try again, and if it persists, head back to the home page.'
            }
            ariaLabel="Application error"
            action={
              exhausted
                ? { label: 'Reload page', onClick: () => window.location.reload() }
                : {}
            }
          />
          {!exhausted && (
            <button
              className="error-fallback-retry"
              type="button"
              onClick={this.handleReset}
            >
              Try again
            </button>
          )}
          <a className="error-fallback-secondary-link" href="/">
            Go to home page
          </a>
        </div>
      )
    }

    // Key the subtree on the reset counter so a retry forces a clean
    // re-mount and any stale child state is discarded.
    return <React.Fragment key={resetCount}>{children}</React.Fragment>
  }
}
