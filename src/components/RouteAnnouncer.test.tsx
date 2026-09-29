import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import RouteAnnouncer, { resolveRouteLabel } from './RouteAnnouncer'

function getAnnouncer(): HTMLElement {
  const el = document.querySelector('.sr-only')
  if (!el) {
    throw new Error('RouteAnnouncer live region not found')
  }
  return el as HTMLElement
}

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
      vi.advanceTimersByTime(100)
    })
    expect(announcer.textContent).toBe('Bond page loaded')
  })

  it('updates text dynamically on active route modifications', () => {
    const { rerender } = render(
      <MemoryRouter key="dashboard" initialEntries={['/dashboard']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByText('Dashboard page loaded')).toBeInTheDocument()

    rerender(
      <MemoryRouter key="/trust" initialEntries={'/trust'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByText('Trust Score page loaded')).toBeInTheDocument()
  })

  it('falls back gracefully to structural 404 descriptions given unknown routes', () => {
    render(
      <MemoryRouter initialEntries={['/some/unknown/route']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByText('Page Not Found loaded')).toBeInTheDocument()
  })

  describe('resolveRouteLabel', () => {
    it('returns the mapped label for every registered route', () => {
      expect(resolveRouteLabel('/')).toBe('Home page')
      expect(resolveRouteLabel('/dashboard')).toBe('Dashboard page')
      expect(resolveRouteLabel('/bond')).toBe('Bond page')
      expect(resolveRouteLabel('/trust')).toBe('Trust Score page')
      expect(resolveRouteLabel('/settings')).toBe('Settings page')
    })

    it('falls back for unknown, malformed, and non-string inputs', () => {
      expect(resolveRouteLabel('/not-real')).toBe('Page Not Found')
      expect(resolveRouteLabel('')).toBe('Page Not Found')
      expect(resolveRouteLabel(undefined)).toBe('Page Not Found')
      expect(resolveRouteLabel(null)).toBe('Page Not Found')
      expect(resolveRouteLabel(123)).toBe('Page Not Found')
    })

    it('does not leak inherited object members for prototype-polluting keys', () => {
      expect(resolveRouteLabel('__proto__')).toBe('Page Not Found')
      expect(resolveRouteLabel('constructor')).toBe('Page Not Found')
      expect(resolveRouteLabel('toString')).toBe('Page Not Found')
      expect(resolveRouteLabel('hasOwnProperty')).toBe('Page Not Found')
    })
  })

  it('cancels a pending announcement when the route changes before the delay elapses', () => {
    function NavigationHarness() {
      const navigate = useNavigate()
      useEffect(() => {
        // Schedule a route change within the announcement delay window.
        const id = setTimeout(() => navigate('/trust'), 50)
        return () => clearTimeout(id)
      }, [navigate])

      return (
        <Routes location={undefined}>
          <Route path="*" element={<RouteAnnouncer />} />
        </Routes>
      )
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <NavigationHarness />
      </MemoryRouter>
    )

    const announcer = getAnnouncer()

    // Advance past the navigation trigger but not past the announcement delay.
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(announcer.textContent).toBe('')

    // Now flush the remaining delay; only the latest route may be announced.
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(announcer.textContent).toBe('Trust Score page loaded')
  })

  it('does not announce again when the same pathname re-renders', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })
    const announcer = getAnnouncer()
    expect(announcer.textContent).toBe('Settings page loaded')

    // Simulate a re-render with the same route; the announcement must not
    // be reset or re-emitted.
    rerender(
      <MemoryRouter initialEntries={'/settings'}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(announcer.textContent).toBe('Settings page loaded')
  })

  it('clears a pending timer on unmount without throwing', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/bond']}>
        <RouteAnnouncer />
      </MemoryRouter>
    )

    expect(() => {
      unmount()
      act(() => {
        vi.advanceTimersByTime(100)
      })
    }).not.toThrow()
  })
})
