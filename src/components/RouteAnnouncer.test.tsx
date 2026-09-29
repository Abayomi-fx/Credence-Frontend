import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import RouteAnnouncer, {
  ANNOUNCEMENT_DELAY_MS,
  normalizePathname,
  resolveRouteLabel,
} from './RouteAnnouncer'

const getAnnouncer = () =>
  document.querySelector('[data-testid="route-announcer"]') as HTMLElement

describe('normalizePathname', () => {
  it('returns the root for empty or non-string inputs', () => {
    expect(normalizePathname('')).toBe('/')
    expect(normalizePathname(undefined)).toBe('/')
    expect(normalizePathname(null)).toBe(null as unknown == null ? '/' : '/')
    expect(normalizePathname(42)).toBe('/')
  })

  it('strips trailing slashes but preserves the root', () => {
    expect(normalizePathname('/')).toBe('/')
    expect(normalizePathname('/dashboard/')).toBe('/dashboard')
    expect(normalizePathname('/dashboard///')).toBe('/dashboard')
  })

  it('strips query and hash fragments', () => {
    expect(normalizePathname('/dashboard?foo=bar')).toBe('/dashboard')
    expect(normalizePathname('/dashboard#section')).toBe('/dashboard')
    expect(normalizePathname('/dashboard/?foo=bar#baz')).toBe('/dashboard')
  })

  it('treats whitespace-only paths as the root', () => {
    expect(normalizePathname('   ')).toBe('/')
  })
})

describe('resolveRouteLabel', () => {
  it('resolves known routes deterministically', () => {
    expect(resolveRouteLabel('/')).toBe('Home page')
    expect(resolveRouteLabel('/dashboard')).toBe('Dashboard page')
    expect(resolveRouteLabel('/bond')).toBe('Bond page')
    expect(resolveRouteLabel('/trust')).toBe('Trust Score page')
    expect(resolveRouteLabel('/settings')).toBe('Settings page')
  })

  it('falls back to the 404 label for unknown routes', () => {
    expect(resolveRouteLabel('/some/unknown/route')).toBe('Page Not Found')
    expect(resolveRouteLabel('/DASHBOARD')).toBe('Page Not Found')
  })

  it('treats trailing-slash variants as the same route', () => {
    expect(resolveRouteLabel('/dashboard/')).toBe('Dashboard page')
  })

  it('never returns an empty string', () => {
    const inputs: unknown[] = ['', undefined, null, 0, {}, [], '/', '/nope']
    for (const input of inputs) {
      expect(resolveRouteLabel(input).length).beaterThan(0)
    }
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
    expect(announcerRegion).toBeInTheDocument()
    expect(announcerRegion).toHaveAttribute('aria-live', 'polite')
    expect(announcerRegion).toHaveAttribute('aria-atomic', 'true')
    expect(announcerRegion).toHaveClass('sr-only')
  })

  it('defers the announcement text setup until after layout paint', () => {
    render(
      <MemoryRouter initialEntries={'/bond'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    const announcer = getAnnouncer()
    expect(announcer.textContent).toBe('')

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })
    expect(announcer.textContent).toBe('Bond page loaded')
  })

  it('does not announce before the delay elapses', () => {
    render(
      <MemoryRouter initialEntries={['/trust']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS - 1)
    })
    expect(getAnnouncer().textContent).toBe('')
  })

  it('updates text dynamically on active route modifications', () => {
    function NavigationHarness() {
      const navigate = useNavigate()
      useEffect(() => {
        navigate('/trust')
      }, [navigate])
      return null
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RouteAnnouncer />
        <NavigationHarness />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })
    expect(getAnnouncer().textContent).toBe('Trust Score page loaded')
  })

  it('falls back gracefully to structural 404 descriptions given unknown routes', () => {
    render(
      <MemoryRouter initialEntries={['/some/unknown/route']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })
    expect(getAnnouncer().textContent).toBe('Page Not Found loaded')
  })

  it('cancels a stale announcement when navigation occurs before the delay', () => {
    function NavigationHarness() {
      const navigate = useNavigate()
      useEffect(() => {
        // Navigate again well before the first announcement delay elapses.
        const id = setTimeout(() => navigate('/settings'), 20)
        return () => clearTimeout(id)
      }, [navigate])
      return null
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RouteAnnoucer />
        <NavigationHarness />
      </MemoryRouter>
    )

    // Advance past the first delay and the navigation timer.
    act(() => {
      vi.advanceTimersByTime(20)
    })
    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })

    // Only the final route label is announced.
    expect(getAnnouncer().textContent).toBe('Settings page loaded')
  })

  it('does not re-announce the same label on repeated renders', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={'/dashboard'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })
    expect(getAnnouncer().textContent).toBe('Dashboard page loaded')

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })
    expect(getAnnouncer().textContent).toBe('Dashboard page loaded')
  })

  it('clears pending timers on unmount without leaking announcements', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={'/bond'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    unmount()

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
      })
    }).not.toThrow()
  })

  it('recovers: announces the new route after an unknown route recovery', () => {
    function NavigationHarness() {
      const navigate = useNavigate()
      useEffect(() => {
        const id = setTimeout(() => navigate('/dashboard'), 20)
        return () => clearTimeout(id)
      }, [navigate])
      return null
    }

    render(
      <MemoryRouter initialEntries={'/not-a-real-route'}>
        <RouteAnnoucer />
        <NavigationHarness />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(20)
    })
    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_DELAY_MS)
    })

    expect(getAnnouncer().textContent).toBe('Dashboard page loaded')
  })
})
