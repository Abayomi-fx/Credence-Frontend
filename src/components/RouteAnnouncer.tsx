import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Centralized registry mapping route paths to human-readable labels.
 * Aligned exactly with NAV_LINKS definitions inside Layout.tsx.
 */
export const ROUTE_LABELS: Record<string, string> = {
  '/': 'Home page',
  '/dashboard': 'Dashboard page',
  '/bond': 'Bond page',
  '/trust': 'Trust Score page',
  '/settings': 'Settings page',
}

/**
 * Fallback label used when a route is not present in the registry.
 * Exported so tests and consumers can rely on a single source of truth.
 */
export const UNKNOWN_ROUTE_LABEL = 'Page Not Found'

/**
 * Delay (ms) before the announcement text is committed.
 * This gives assistive technology time to process the structural navigation
 * change before the live region mutates.
 */
export const ANNOUNCE_DELAY_MS = 100

/**
 * Resolve the human-readable label for a given pathname.
 *
 * This is the single authority for label resolution and is pure so it can be
 * exercised directly in tests for boundary cases (unknown, empty, duplicate,
 * trailing-slash, and query/hash bearing) paths.
 */
export function resolveRouteLabel(pathname: unknown): string {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    return UNKNOWN_ROUTE_LABEL
  }

  // Normalize trailing slashes so '/dashboard/' matches '/dashboard'.
  // The root path is kept as-is to avoid collapsing it to an empty string.
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  if (Object.prototype.hasOwnProperty.call(ROUTE_LABELS, normalized)) {
    return ROUTE_LABELS[normalized]
  }

  return UNKNOWN_ROUTE_LABEL
}

/**
 * RouteAnnouncer renders a visually-hidden aria-live region.
 * This guarantees screen reader notifications fire reliably across dynamic
 * single-page application (SPA) client transitions.
 *
 * Invariants:
 *   - The announcement is always a non-empty string once the delay elapses.
 *   - Rapid consecutive navigations must not leak a stale announcement from a
 *     previous route (each effect clears its pending timer).
 *   - The region is always visually hidden and never exposes raw path data.
 */
export default function RouteAnnouncer() {
  const { pathname } = useLocation()
  const announcementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const label = resolveRouteLabel(pathname)
    const nextAnnouncement = `${label} loaded`

    // Defer text-assignment slightly until just after the DOM paint completes.
    // This allows assistive tech to cleanly process structural navigation changes.
    const timer = setTimeout(() => {
      const node = announcementRef.current
      if (!node) {
        return
      }
      // Idempotent write: repeated navigation to the same route does not
      // re-trigger assistive tech with duplicate text.
      if (node.textContent !== nextAnnouncement) {
        node.textContent = nextAnnouncement
      }
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
