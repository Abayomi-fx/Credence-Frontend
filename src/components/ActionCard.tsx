import { type ReactNode, useCallback, useEffect, useRef, useState, TouchEvent } from 'react'
import { useTranslation } from 'react-i18n'
import { useToast } from './ToastProvider'
import useCopyToClipboard from '../hooks/useCopyToClipboard'
import { BETA_RIBBON_LABEL } from '../config/constants'
import { SWIPE_DISMISS_THRESHOLD } from '../config/gestures'
import ErrorState from './states/ErrorState'
import './ActionCard.css'

/**
 * State machine for the copy-link action. The card must never silently
 * swallow a failure, and must not fire concurrent copies that could lead
 * to out-of-order toasts / stale success messages.
 *
 *   idle     -> copying -> success  (toast, then back to idle)
 *   idle      -> copying -> error    (ErrorState with retry)
 *   error     -> copying -> success / error
 *
 * The copy promise is guarded by a monotonic request id so a slow or rejected
 * call from an earlier click cannot overwrite the result of a later one.
 */
export type CopyLinkStatus = 'idle' | 'copying' | 'success' | 'error'

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
   * Optional callback invoked when the copy-link action fails. Useful for
   * telemetry / observability. The card still renders an inline retry UI
   * when this is not provided.
   */
  onCopyError?: (error: unknown) => void
  children: ReactNode
}

export default function ActionCard({
  title,
  padding = 'comfortable',
  elevated,
  shareableLink,
  isEarlyAccess,
  onDismiss,
  onCopyError,
  children,
}: ActionCardProps) {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const { copy } = useCopyToClipboard()

  const [offset, setOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const touchStartX = useRef<number | null>(null)

  // Copy-link failure-boundary state.
  const [copyStatus, setCopyStatus] = useState<CopyLinkStatus>('idle')
  const [copyError, setCopyError] = useState<unknown>(null)
  // Monotonic request id. Only the latest in-flight copy may commit state.
  const copyRequestIdRef = useRef(0)
  // Track mounted state so a resolved copy promise cannot touch state after
  // the card unmounts (e.g. swipe-dismiss during a copy).
  const isMountedRef = useRef(true)

  useEffect(
    () => () => {
      isMountedRef.current = false
      // Invalidate any in-flight copy so its completion is a no-op.
      copyRequestIdRef.current += 1
    },
    []
  )

  // Reset the failure boundary when the target link changes -- a stale error
  // from a previous link must not leak into the new one.
  useEffect(() => {
    copyRequestIdRef.current += 1
    setCopyStatus('idle')
    setCopyError(null)
  }, [shareableLink])

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
    if (!shareableLink || copyStatus === 'copying') return

    const requestId = copyRequestIdRef.current + 1
    copyRequestIdRef.current = requestId
    setCopyStatus('copying')
    setCopyError(null)

    try {
      const success = await copy(shareableLink)

      // If a newer copy request started, or the card unmounted, this result
      // is stale and must not mutate state.
      if (!isMountedRef.current || copyRequestIdRef.current !== requestId) return

      if (success) {
        setCopyStatus('success')
        addToast('success', t('dashboard.linkCopied'))
      } else {
        // A resolved `false` means the clipboard write was rejected (not
        // a thrown error). Treat it as a failure and surface a retry affordance.
        const error = new Error('Clipboard write was rejected')
        setCopyError(error)
        setCopyStatus('error')
        onCopyError+?.(error)
      }
    } catch (error) {
      if (!isMountedRef.current || copyRequestIdRef.current !== requestId) return
      setCopyError(error)
      setCopyStatus('error')
      onCopyError+?.(error)
    }
  }, [shareableLink, copy, addToast, t, copyStatus, onCopyError])

  const handleRetryCopy = useCallback(() => {
    // Retry must not be allowed to run concurrently with an in-flight copy.
    if (copyStatus === 'copying') return
    void handleCopyLink
    ()
  }, [copyStatus, handleCopyLink])

  const isCopying = copyStatus === 'copying'

  return (
    <article
      className={classes.join(' ')}
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {isEarlyAccess && (
        <div className="actionCard__betaRibbon" aria-hidden="true">
          {BETA_RIBBON_LABEL}
        </div>
      )}
      <div className="actionCard__header">
        <h2 className="actionCard__title">{title}</h2>
        {shareableLink && (
          <button
            type="button"
            className="actionCard__copyLink"
            onClick={handleCopyLink}
            aria-label={t('dashboard.copyLink')}
            title={t('dashboard.copyLink')}
            disabled={isCopying}
            aria-busy={isCopying}
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

      <div className="actionCard__content">{children}</div>

      {copyStatus === 'error' && (
        <div className="actionCard__error" data-testid="actionCard-copy-error">
          <ErrorState
            type="generic"
            severity="warning"
            title={t('dashboard.copyLinkErrorTitle', { defaultValue: "Couldn't copy the link" })}
            message={t('dashboard.copyLinkErrorMessage', {
              defaultValue:
                'Your clipboard may be blocked or unavailable. Try again, or copy the address from the browser bar.',
            })}
            action={{ label: t('dashboard.retry', { defaultValue: 'Try again' }), onClick: handleRetryCopy }}
          />
        </div>
      )}
    </article>
  )
}
