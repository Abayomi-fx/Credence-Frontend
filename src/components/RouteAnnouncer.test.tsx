import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import RouteAnnouncer, {
  ANNOUNCE_DELAY_MS,
  ROUTE_LABELS,
  UNKNOWN_ROUTE_LABEL,
  resolveRouteLabel,
} from './RouteAnnouncer'

function getAnnouncer(): HTMLElement {
  return document.querySelector('.sr-only') as HTMLElement
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimesByTime(ms)
  })
}

function NavigationTrigger({ to }: { to: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(to)
  }, [navigate, to])
  return null
}

describe('resolveRouteLabel', () => {
  it('resolves every registered route to its label', () => {
    for (const [path, label] of Object.entries(ROUTE_LABELS)) {
      expect(resolveRouteLabel(path)).toBe(label)
    }
  })

  it('normalizes trailing slashes for non-root routes', () => {
    expect(resolveRouteLabel('/dashboard/')).toBe('Dashboard page')
    expect(resolveRouteLabel('/bond///')).toBe('Bond page')
  })

  it('preserves the root path label', () => {
    expect(resolveRouteLabel('/')).toBe('Home page')
  })

  it('returns the unknown label for unmapped, malformed, or empty inputs', () => {
    expect(resolveRouteLabel('/not-in-the-registry')).toBe(UNKNOWN_ROUTE_LABEL)
    expect(resolveRouteLabel('')).toBe(UNKNOWN_ROUTE_LABEL)
    expect(resolveRouteLabel(undefined as unknown as string)).toBe(UNKNOWN_ROUTE_LABEL)
    expect(resolveRouteLabel(null as unknown as string)).toBe(UNKNOWN_ROUTE_LABEL)
  })

  it('does not leak prototype properties from the registry', () => {
    expect(resolveRouteLabel('/constructor')).toBe(UNKNOWN_ROUTE_LABEL)
    expect(resolveRouteLabel('/__proto__')).toBe(UNKNOWN_ROUTE_LABEL)
    expect(resolveRouteLabel('/toString')).toBe(UNKNOWN_ROUTE_LABEL)
  })
})

describe('RouteAnnouncer Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is visually hidden but correctly structured in the DOM tree on mount', () => {
    render(
      <MemoryRouter initialEntries={'/dashboard'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    const announcerRegion = getAnnouncer()
    expect(announcerRegion).toHaveAttribute('aria-live', 'polite')
    expect(announcerRegion).toHaveAttribute('aria-atomic', 'true')
    expect(announcerRegion).toHaveAttribute('role', 'none')
  })

  it('defers the announcement text setup until after layout paint', () => {
    render(
      <MemoryRouter initialEntries={'/bond'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    const announcer = getAnnouncer()
    expect(announcer.textContent).toBe('')

    advance(ANNOUNCE_DELAY_MS)
    expect(announcer.textContent).toBe('Bond page loaded')
  })

  it('does not announce before the delay elapses', () => {
    render(
      <MemoryRouter initialEntries=${'/settings'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS - 1)
    expect(getAnnouncer().textContent).toBe('')

    advance(1)
    expect(getAnnouncer().textContent).toBe('Settings page loaded')
  })

  it('updates text dynamically on active route modifications', () => {
    const { rerender } = render(
      <MemoryRouter key="dashboard" initialEntries={'/dashboard'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(screen.getByText('Dashboard page loaded')).toBeInTheDocument()

    rerender(
      <MemoryRouter key="/trust" initialEntries={'/trust'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(screen.getByText('Trust Score page loaded')).toBeInTheDocument()
  })

  it('falls back gracefully to structural 404 descriptions given unknown routes', () => {
    render(
      <MemoryRouter initialEntries={'/some/unknown/route'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(screen.getByText('Page Not Found loaded')).toBeInTheDocument()
  })

  it('resolves trailing-slash routes to the correct label', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/'] }>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(screen.getByText('Dashboard page loaded')).toBeInTheDocument()
  })

  it('cancels a pending announcement when navigating rapidly (stale timer)', () => {
    const { rerender } = render(
      <MemoryRouter key="bond" initialEntries={['/bond']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    // Navigate away before the first announcement can flush.
    advance(ANNOUNCE_DELAY_MS - 1)
    rerender(
      <MemoryRouter key="settings" initialEntries={'/settings'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    // Flush the stale timer window and the new timer window.
    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Settings page loaded')
    expect(screen.queryByText('Bond page loaded')).not.toBeInTheDocument()
  })

  it('collapses duplicate navigation to the same route without duplicate text', () => {
    const { rerender } = render(
      <MemoryRouter key="home" initialEntries={'/'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Home page loaded')

    rerender(
      <MemoryRouter key="home-again" initialEntries={'/'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Home page loaded')
    expect(screen.getAllByText('Home page loaded')).toHaveLength(1)
  })

  it('recovers from an unknown route back to a known route', () => {
    const { rerender } = render(
      <MemoryRouter key="unknown" initialEntries=${'/missing'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Page Not Found loaded')

    rerender(
      <MemoryRouter key="known" initialEntries={['/trust']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Trust Score page loaded')
  })

  it('announces the correct label after a real client-side navigation', () => {
    render(
      <MemoryRouter initialEntries={'/dashboard'}>
        <RouteAnnouncer />
        <NavigationTrigger to="/settings" />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Settings page loaded')
  })

  it('keeps the live region mounted and hidden across route changes', () => {
    const { rerender } = render(
      <MemoryRouter key="a" initialEntries={['/']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    const first = getAnnouncer()
    advance(ANNOUNCE_DELAY_MS)

    rerender(
      <MemoryRouter key="b" initialEntries=${'/bond'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )
    advance(ANNOUNCE_DELAY_MS)

    expect(getAnnouncer()).toHaveAttribute('aria-live', 'polite')
    expect(getAnnouncer().textContent).toBe('Bond page loaded')
    expect(first).toBeInTheDocument()
  })

  it('does not expose the raw pathname in the announcement', () => {
    render(
      <MemoryRouter initialEntries={['/secret-token-123'] }>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Page Not Found loaded')
    expect(getAnnouncer().textContent).not.toContain('secret')
  })

  it('clears the pending timer on unmount without throwing', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/bond']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    expect(() => {
      unmount()
      vi.advanceTimesByTime(ANNOUNCE_DELAY_MS)
    }).not.toThrow()
  })

  it('recovers correctly after a mount/unmount/remount cycle', () => {
    const first = render(
      <MemoryRouter initialEntries=${'/dashboard'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )
    first.unmount()

    render(
      <MemoryRouter initialEntries={['/trust']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    advance(ANNOUNCE_DELAY_MS)
    expect(getAnnouncer().textContent).toBe('Trust Score page loaded')
  })

  it('resolves the correct label for every registered route through the component', () => {
    for (const [path, label] of Object.entries(ROUTE_LABELS)) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path as string]}>
          <RouteAnnoucer />
        </MemoryRouter>
      )
      advance(ANNOUNCE_DELAY_MS)
      expect(getAnnouncer().textContent).toBe($label} loaded`)
      unmount()
    }
  })

  it('renders an empty live region before the delay and never exposes undefined', () => {
    render(
      <MemoryRouter initialEntries={'/dashboard'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    const announcer = getAnnouncer()
    expect(announcer.textContent).toBe('')
    expect(announcer.textContent).not.toContain('undefined')
  })
})
