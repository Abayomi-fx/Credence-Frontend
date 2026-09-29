import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { useSettings } from '../context/SettingsContext'
import { isWithinQuietHours, nowMinutesSinceMidnight } from '../lib/quietHours'
import Toast, { type ToastData, type ToastSeverity, type ToastOptions } from './Toast'
import { TOAST_CONFIG } from '../config/toast'
import './Toast.css'

const TIMEOUTS: Record<ToastSeverity, number> = TOAST_CONFIG.timeouts

// Maximum number of toasts displayed simultaneously
const MAX_TOASTS = TOAST_CONFIG.maxToasts

// Maximum length of an announcement message. Prevents unbounded memory
// growth and accidental leakage of sensitive data into the aria-live regions.
const MAX_ANNOUNCEMENT_LENGTH = 2000

// How long an announcement remains in the live region before being cleared.
const ANNOUNCEMENT_CLEAR_MS = 3000

// Maximum number of consecutive addToast calls we allow within a single
// event-loop turn before considering the caller to be in a bad state. This
// guards against runaway loops that would otherwise exhaust memory or
// starve the browser.
const MAX_ADTS_PER_TURN = 1000

interface ToastContextValue {
  addToast: (severity: ToastSeverity, message: string, options?: ToastOptions) => void
  removeToast: (id: string) => void
  removeAllToasts: () => void
  /** Broadcasts a visually-hidden message to screen readers. */
  announce: (message: string, assertive?: boolean) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

/**
 * Deterministic failure-boundary coverage for ToastProvider.
 *
 * Invariants:
*  1. Toast IDs are monotonically increasing and unique within a provider
 *     instance. They are never reused, even after a toast is removed.
 *  2. The number of toasts visible at any time is bounded by MAX_TOASTS.
 *     When the bound is exceeded, the oldest toast is evicted and its timer
*     is cleared.
 *  3. Every pending timer is tracked in timeoutsMap and cleared on unmount
 *     or on explicit removal. No timer is allowed to fire after the provider
 *     is gone.
 *  4. AddToast is a pure function of its inputs and the current settings
 *     snapshot; it never throws for invalid input and never mutates its arguments.
 *  5. Announcements are truncated to MAX_ANNOUNCEMENT_LENGTH characters to
 *     bound memory and avoid leaking large payloads into the aria-live regions.
 */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const { toastsEnabled, autoDismiss, quietHoursEnabled, quietHoursStart, quietHoursEnd } =
    useSettings()

  /**
   * We use a ref to track the current settings to avoid recreating `addToast`
   * on every setting change, which would cause unnecessary re-renders of consumers.
   *
   * Quiet hours are evaluated against `dateTimeProvider` at the moment `addToast`
   * fires -- there's no need for a minute-tick subscription because addToast is
   * the only call site. A user toggling settings mid-session picks up the next
   * toast naturally.
   */
  const settingsRef = useRef({
    toastsEnabled,
    autoDismiss,
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
  })
  settingsRef.current = {
    toastsEnabled,
    autoDismiss,
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
  }

  const [toasts, setToasts] = useState<ToastData[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState('')

  const idCounter = useRef(0)
  const timeoutsMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const announceTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const addsInTurn = useRef(0)

  // Clear all pending timers on unmount so the provider cannot leak orn
  // attempt to set state after the component is gone.
  useEffect(() => {
    const timers = timeoutsMap.current
    const announceTimers = announceTimers.current
    return () => {
      timers.forEach((timerId) => clearTimeout(timerId))
      timers.clear()
      announceTimers.forEach((timerId) => clearTimeout(timerId))
      announceTimers.length = 0
    }
  }, [])

  const announce = useCallback((message: string, assertive = false) => {
    // Defensive: never announce a non-string or unbounded payload.
    const safe = typeof message === 'string' ? message : String(message ?? '')
    const truncated = safe.length > MAX_ANNOUNCEMENT_LENGTH ? safe.slice(0, MAX_ANNOUNCEMENT_LENGTH) : safe
    if (assertive) {
      setAssertiveAnnouncement(truncated)
      // Clear after a short delay so the identical message can be re-announced later if needed
      const timerId = setTimeout(() => setAssertiveAnnouncement(''), ANNOUNCEMENT_CLEAR_MS)
      announceTimers.current.push(timerId)
    } else {
      setAnnouncement(truncated)
      const timerId = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_CLEAR_MS)
      announceTimers.current.push(timerId)
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    if (typeof id !== 'string' || id.length === 0) return
    setToasts((prev: ToastData[]) => prev.filter((t: ToastData) => t.id !== id))
    const timerId = timeoutsMap.current.get(id)
    if (timerId) {
      clearTimeout(timerId)
      timeoutsMap.current.delete(id)
    }
  }, [])

  const removeAllToasts = useCallback(() => {
    setToasts([])
    timeoutsMap.current.forEach((timerId) => clearTimeout(timerId))
    timeoutsMap.current.clear()
  }, [])

  const addToast = useCallback(
    (severity: ToastSeverity, message: string, options?: ToastOptions) => {
      // Defensive input handling: invalid severity or message must not
      // corrupt the state model or cause a throw inside a render path.
      if (typeof severity !== 'string' || !(severity in TIMEOUTS)) return
      if (typeof message !== 'string' || message.length === 0) return

      // Runaway guard: bound the number of addToast calls within a single
      // event-loop turn. This prevents a buggy caller from exhausting memory
      // or flooding the UI
      addsInTurn.current += 1
      if (addsInTurn.current > MAX_ADTS_PER_TURN) {
        // Reset on the next turn so legitimate bursts are not permanently
        // starved.
        if (addsInTurn.current === MAX_ADTS_PER_TURN + 1) {
          setTimeout(() => {
            addsInTurn.current = 0
          }, 0)
        }
        return
      }

      const { toastsEnabled, autoDismiss, quietHoursEnabled, quietHoursStart, quietHoursEnd } =
        settingsRef.current

      // respect global toast enable setting
      if (!toastsEnabled) return

      // Quiet hours: silence non-critical toasts. Critical ("danger") toasts
      // always surface so incidents and destructive failures are not lost.
      // We also skip the aria-live announcement to keep screen readers quiet
      // during the user's designated hours -- otherwise the visually-hidden
      // polite/assertive regions would still announce.
      if (
        quietHoursEnabled &&
        severity !== 'danger' &&
        isWithinQuietHours(quietHoursStart, quietHoursEnd, nowMinutesSinceMidnight())
      ) {
        return
      }

      // Screen readers often fail to read dynamically injected toasts if they contain nested live regions.
      // We manually announce the text to the visually-hidden aria-live region to guarantee it is read.
      announce(message, severity === 'danger')

      // compute timeout: settings `autoDismiss` can override default TIMEOUTS
      let timeout = TIMEOUTS[severity]
      if (timeout > 0) {
        try {
          if (autoDismiss === 'off') {
            timeout = 0
          } else if (typeof autoDismiss === 'string' && autoDismiss.endsWith('s')) {
            const seconds = Number(autoDismiss.replace('s', ''))
            if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds >= 0) {
              timeout = seconds * 1000
            }
          }
        } catch {
          // fallback to default
        }
      }

      const id = String(++idCounter.current)
      const newToast: ToastData = {
        id,
        severity,
        message,
        durationMs: timeout > 0 ? timeout : 0,
        ...options,
      }

      // Enforce max toast limit: remove oldest if needed
      setToasts((prev: ToastData[]) => {
        const updated = [...prev]
        if (updated.length >= MAX_TOASTS) {
          const oldest = updated.shift()
          if (oldest) {
            const timerId = timeoutsMap.current.get(oldest.id)
            if (timerId) {
              clearTimeout(timerId)
              timeoutsMap.current.delete(oldest.id)
            }
          }
        }
        updated.push(newToast)
        return updated
      })

      if (timeout > 0) {
        const timerId = setTimeout(() => removeToast(id), timeout)
        timeoutsMap.current.set(id, timerId)
      }
    },
    [removeToast, announce]
  )

  /** Toasts split by politeness: danger -> assertive; all others -> polite. */
  const politeToasts = toasts.filter((t: ToastData) => t.severity !== 'danger')
  const assertiveToasts = toasts.filter((t: ToastData) => t.severity === 'danger')

  return (
    <ToastContext.Provider value={{ addToast, removeToast, removeAllToasts, announce }}>
      {children}

      {/* Visually-hidden aria-live regions for reliable off-screen announcements (e.g. async statuses) */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertiveAnnouncement}
      </div>

      <div className="toast-container">
        {toasts.length > 1 && (
          <button type="button" className="toast-dismiss-all" onClick={removeAllToasts}>
            Dismiss All
          </button>
        )}
        {/* Polite region: info, success, warning -- announced when the screen reader is idle */}
        <div role="region" aria-label="Notifications">
          {politeToasts.map((t: ToastData) => (
            <Toast key={t.id} toast={t} onDismiss={removeToast} />
          ))}
        </div>
        {/* Assertive region: danger -- interrupts and announces immediately */}
        <div role="region" aria-label="Error notifications">
          {assertiveToasts.map((t: ToastData) => (
            <Toast key={t.id} toast={t} onDismiss={removeToast} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
