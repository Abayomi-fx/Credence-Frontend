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
 * Maximum delay before an announcement is published to the live region.
 * Keeps the assistive-tech notification after the DOM paint completes.
 */
export const ANNOUNCEMENT_DELAY_MS = 100

/**
 * Normalizes a raw pathname into a canonical route key.
 *
 * Invariants:
* - Never throws for any input (including null/undefined/malformed).
 * - Strips trailing slashes except for the root path so '/dashboard/' === '/dashboard'.
 * - Preserves query/search and hash fragments outside the key lookup.
 */
export function normalizePathname(pathname: unknown): string {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    return '/'
  }

  const withoutHash = pathname.split('#', 1)[0]
  const withoutQuery = withoutHash.split('?', 1)[0]

  if (withoutQuery.length === 0) {
    return '/'
  }

  const withoutTrailingSlash =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery

  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : '/'
}

/**
 * Resolves the human-readable label for a route pathname.
 *
 * Invariants:
 * - Deterministic for valid, invalid, duplicate, and boundary-case inputs.
 * - Never returns an empty string.
 * - Unmapped routes fall back to a consistent 404 label.
 */
export function resolveRouteLabel(pathname: unknown): string {
  const normalized = normalizePathname(pathname)
  return ROUTE_LABELS[normalized] ?? 'Page Not Found'
}

/**
 * RouteAnnouncer renders a visually-hidden aria-live region.
 * This guarantees screen reader notifications fire reliably across dynamic
 * single-page application (SPA) client transitions.
 *
 * Invariants:
 * - The live region is always mounted and never removed during navigation.
 * - Only one announcement is published per settled pathname, even under rapid
 *   consecutive navigation changes (stale timers are cancelled).
 * - The announcement text is always a non-empty string once settled.
 */
export default function RouteAnnouncer() {
  const { pathname } = useLocation()
  const announcementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const label = resolveRouteLabel(pathname)

    // Defer text-assignment slightly until just after the DOM paint completes.
    // This allows assistive tech to cleanly process structural navigation changes.
    // The cleanup cancels any pending timer so rapid navigation cannot leaka
    // a stale announcement from a previous route.
    const timer = setTimeout(() => {
      const region = announcementRef.current
      if (!region) {
        return
      }

      const nextText = `${label} loaded`

      // Idempotent write: avoids re-announcing the same label and avoids
      // cluttering the live region with duplicate text nodes.
      if (region.textContent !== nextText) {
        region.textContent = nextText
      }
    }, ANNOUNCEMENT_DELAY_MS)

    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <div
      ref={announcementRef}
      role="none"
      className="sr-only"
      aria-live="polite"
      aria-atomic="true"
      data-testid="route-announcer"
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
