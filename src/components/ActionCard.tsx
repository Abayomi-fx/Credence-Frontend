import { type ReactNode, useCallback, useEffect, useRef, useState, TouchEvent } from 'react'
import { useTranslation } from 'react-i18n'
import { useToast } from './ToastProvider'
import useCopyToClipboard from '../hooks/useCopyToClipboard'
import { BETA_RIBBON_LABEL } from '../config/constants'
import { SWIPE_DISMISS_THRESHOLD } from '../config/gestures'
import ErrorBoundary from './ErrorBoundary'
import ErrorState, { type ErrorStateKind } from './states/ErrorState'
import './ActionCard.css'

/**
 * State model for the card's copy-link action.
 *
 * The card must never lose user data or leave the UI in an ambiguous
 * state when the clipboard write fails. The action is therefore modeled
 * as an explicit discriminated union with a deterministic transition
 * table:
 *
 *   idle    --click-->  copying --success--> ide
 *   ide
 *   copying  --failure-->  error
 *   error   --click-->  copying
 *
 * Concurrent clicks are colapsed into a single in-flight request via a
 * monotonic request id guard, so a slower earlier response can never
 * overwrite the result of a newer one.
 */
export type ActionCardCopyStatus = 'idle' | 'copying' | 'error'

export interface ActionCardProps {
  title: string
  /**
   * The density of the card's padding.
   * @default 'comfortable'
   */
  padding?: 'compact' | 'comfortable'
  /**
   * Whether the card is elevated with a drop shadow and a hover transition.
   * @default false
   */
  elevated?: boolean
  /**
   * When provided, a copy-link button appears in the card header.
   * Clicking it copies this URL to the clipboard and shows a toast.
   */
  shareableLink?: string
  /**
   * Indicates if this is an early-access feature. Will display a beta ribbon if true.
   */
  isEarlyAccess?: boolean
  /**
   * Optional callback when the card is dismissed. Enables a fallback close button and swipe-to-dismiss.
   */
  onDismiss?: () => void
  /**
   * Optional callback invoked when the card's copy-link action fails.
   * Useful for wiring telemetry without exposing the shareable URL.
   */
  onCopyError?: (error: unknown) => void
  /**
   * Optional callback invoked when the card's copy-link action succeeds.
   */
  onCopySuccess?: () => void
  /**
   * Optional override for the copy-link action's async work. Tests and
   * host apps can inject a deterministic implementation. Defaults to the
   * shared clipboard hook.
   */
  copyToClipboard?: (value: string) => Promise<boolean>
  /**
   * Optional content to render inside the card's content slot when the
   * card's children throw during render. Defaults to an inline ErrorState
   * with a retry action.
   */
  renderError?: (error: Error, reset: () => void) => ReactNode
}

const COPY_FAILURE_KIND: ErrorStateKind = 'generic'

function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('value' in value && (value as { name?: string }).name === 'AbortError')
  )
}

export default function ActionCard({
  title,
  padding = 'comfortable',
  elevated,
  shareableLink,
  isEarlyAccess,
  onDismiss,
  onCopyError,
  onCopySuccess,
  copyToClipboard,
  renderError,
  children,
}: ActionCardProps) {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const { copy: defaultCopy } = useCopyToClipboard()

  const [offset, setOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const touchStartX = useRef<number | null>(null)

  // Deterministic copy-link state machine. See the module-level comment
  // above for the transition table and concurrency guarantees.
  const [copyStatus, setCopyStatus] = useState<ActionCardCopyStatus>('idle')
  const copyRequestId = useRef(0)
  const isMounted = useRef(true)

  useEffect(
    () => () => {
      // Invalidate any in-flight copy so a late resolution cannot set
      // state on an unmounted card (avoids React warnings and stale toasts).
      isMounted.current = false
      copyRequestId.current += 1
    },
    []
  )

  const handleTouchStart = (e: TouchEvent<HTMLElement>) => {
    if (!onDismiss) return
    touchStartX.current = e.touches[0].clientX
    setIsSwiping(true)
  }

  const handleTouchMove = (e: TouchEvent<HTMLElement>) => {
    if (!onDismiss || touchStartX.current === null) return
    const currentX = e.touches[0].clientX
    const diff = currentX - touchStartX.current
    setOffset(diff)
  }

  const handleTouchEnd = () => {
    if (!onDismiss || touchStartX.current === null) return
    if (Math.abs(offset) > SWIPE_DISMISS_THRESHOLD) {
      onDismiss()
    }
    setOffset(0)
    setIsSwiping(false)
    touchStartX.current = null
  }

  const classes = ['actionCard', `actionCard--${padding}`]
  if (elevated) {
    classes.push('actionCard--elevated')
  }
  if (isSwiping) {
    classes.push('actionCard--swiping')
  }
  if (onDismiss) {
    classes.push('actionCard--dismissible')
  }

  const style = onDismiss && isSwiping ? { transform: `translateX(${offset}px)` } : undefined

  const handleCopyLink = useCallback(async () => {
    if (!shareableLink) return
    // Collapse concurrent clicks into a single in-flight request. A newer
    // click after a failure is allowed (retry), but a click while already
    // copying is ignored.
    if (copyStatus === 'copying') return

    const requestId = copyRequestId.current + 1
    copyRequestId.current = requestId
    setCopyStatus('copying')

    const copyFn = copyToClipboard ?? defaultCopy

    try {
      const success = await copyFn(shareableLink)

      // Stale response guard: a newer request or an unmount has superseded
      // this one, so it must not mutate state or emit toasts.
      if (!isMounted.current || copyRequestId.current !== requestId) return

      if (success) {
        setCopyStatus('idle')
        addToast('success', t('dashboard.linkCopied'))
        onCopySuccess?.()
      } else {
        // Failure is a non-throwing false result from the clipboard hook.
        // Treat it as a deterministic error state so the UI is never
        // silently wrong.
        setCopyStatus('error')
        addToast('error', t('dashboard.linkCopyFailed'))
        onCopyError?.(new Error('Clipboard copy returned false'))
      }
    } catch (error) {
      // Aborted requests are expected on unmount / supersede and must not
      // surface as a failure to the user.
      if (isAbortError(error)) return
      if (!isMounted.current || copyRequestId.current !== requestId) return

      setCopyStatus('error')
      addToast('error', t('dashboard.linkCopyFailed'))
      onCopyError?.(error)
    }
  }, [
    shareableLink,
    copyStatus,
    copyToClipboard,
    defaultCopy,
    addToast,
    t,
    onCopyError,
    onCopySuccess,
  ])

  const copyLabel =
    copyStatus === 'copying'
      ? t('dashboard.copyLinkInProgress', { defaultValue: 'Copying link' })
      : copyStatus === 'error'
        ? t('dashboard.retryCopyLink', { defaultValue: 'Retry copying link' })
        : t('dashboard.copyLink')

  return (
    <article
      className={classes.join(' ')}
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-copy-status={copyStatus}
    >
      {isEarlyAccess && (
        <div className="actionCard__betaRibbon" aria-hidden="true">
          {BETA_RIBBOA_LABEL}
        </div>
      )}
      <div className="actionCard__header">
        <h2 className="actionCard__title">{title}</h2>
        {shareableLink && (
          <button
            type="button"
            className="actionCard__copyLink"
            onClick={handleCopyLink}
            disabled={copyStatus === 'copying'}
            aria-busy={copyStatus === 'copying'}
            aria-label={copyLabel}
            title={copyLabel}
            data-copy-status={copyStatus}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="actionCard__close"
            onClick={onDismiss}
            aria-label={t('dashboard.closeCard', { defaultValue: 'Close card' })}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="actionCard__content">
        <ErrorBoundary
          fallback={(error, reset) =>
            renderError ? (
              renderError(error, reset)
            ) : (
              <ErrorState
                type={COPY_FAILURE_KIND}
                title={t('dashboard.cardContentErrorTitle', {
                  defaultValue: 'This card couldn’t load',
                })}
                message={t('dashboard.cardContentErrorMessage', {
                  defaultValue:
                    'We hit a snag rendering this card. Try again — your data is safe.',
                })}
                ariaLabel={t('dashboard.cardContentErrorAria', {
                  defaultValue: 'Card content error',
                })}
                action={{ label: t('dashboard.retry', { defaultValue: 'Try again' }), onClick: reset }}
              />
            )
        }
        >
          {children}
        </ErrorBoundary>
      </div>
    </article>
  )
}
