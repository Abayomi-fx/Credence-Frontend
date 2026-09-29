import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Centralized registry mapping route paths to human-readable labels.
 * Aligned exactly with NAV_LINKS definitions inside Layout.tsx.
 */
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Home page',
  '/dashboard': 'Dashboard page',
  '/bond': 'Bond page',
  '/trust': 'Trust Score page',
  '/settings': 'Settings page',
}

/**
 * Delay (ms) before announcing a route change.
 * This allows assistive tech to cleanly process structural navigation changes.
 */
const ANNOUNCE_DELAY_MS = 100

/**
 * Resolve a human-readable label for a route pathname.
 *
 * The lookup is deterministic and total: any value that is not a own property
 * of the registry (including inherited object keys like `__proto__`,
 * `constructor`, `toString`) falls back to the 404 label. This guarantees
 * unknown, malformed, or prototype-polluting inputs cannot leak internal
 * object members into the announcement text.
 */
export function resolveRouteLabel(pathname: unknown): string {
  if (typeof pathname !== 'string') {
    return 'Page Not Found'
  }

  if (Object.prototype.hasOwnProperty.call(ROUTE_LABELS, pathname)) {
    return ROUTE_LABELS[pathname]
  }

  return 'Page Not Found'
}

/**
 * RouteAnnouncer renders a visually-hidden aria-live region.
 * This guarantees screen reader notifications fire reliably across dynamic
 * single-page application (SPA) client transitions.
 *
 * Invariants:
  - The announcement text is always a string derived from the current
    pathname via `resolveRouteLabel`.
  - Only the most recent pathname may produce an announcement; stale
    timers from prior routes are cancelled on every change and on unmount.
  - The text is never announced twice for the same pathname, even when
    React re-runs the effect for unrelated reasons.
 */
export default function RouteAnnouncer() {
  const { pathname } = useLocation()
  const announcementRef = useRef<HTMLElement | null>(null)
  const lastPathnameRef = useRef(undefined as string | undefined)

  useEffect(() => {
    // Skip duplicate effect runs for the same pathname. This keeps the
    // announcement deterministic even if the component re-renders for
    // unrelated state changes.
    if (lastPathnameRef.current === pathname) {
      return
    }
    lastPathnameRef.current = pathname

    // Fallback gracefully handles catch-all configurations or unmapped routes like 404s
    const pageLabel = resolveRouteLabel(pathname)

    // Defer text-assignment slightly until just after the DOM paint completes.
    // This allows assistive tech to cleanly process structural navigation changes.
    const timer = setTimeout(() => {
      const region = announcementRef.current
      if (!region) {
        return
      }
      // Write directly to the live region so the announcement is atomic
      // and cannot be interleaved with a stale timer from a prior route.
      region.textContent = `${pageLabel} loaded`
    }, ANNOUNCE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <div
      ref={announcementRef}
      role="none"
      className="sr-only"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    />
  )
}
