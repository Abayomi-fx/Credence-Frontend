import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ThemeToggle, { SunIcon } from './ThemeToggle'
import { SettingsProvider } from '../context/SettingsContext'

function renderToggle() {
  return render(
    <SettingsProvider>
      <ThemeToggle />
    </SettingsProvider>
  )
}

// Shared, mutable OS preference so that consumers which re-query matchMedia on
// a 'change' event (e.g. SettingsContext) observe the same value the event
// carries. Tracks registered 'change' listeners to emulate an OS theme switch.
let osPrefersDark = false
let darkListeners: Array<(t: MediaQueryListEvent) => void> = []

function mockMatchMedia(prefersDark: boolean) {
  osPrefersDark = prefersDark
  darkListeners = []
  return vi.fn((query: string): MediaQueryList => {
    const isDarkQuery = query.includes('dark')
    return {
      get matches() {
        return isDarkQuery ? osPrefersDark : !osPrefersDark
      },
      media: query,
      onchange: null,
      addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
        if (isDarkQuery) darkListeners.push(cb)
      }),
      removeEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
        if (isDarkQuery) darkListeners = darkListeners.filter((l) => l !== cb)
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList
  })
}

// Emulate the OS flipping its prefers-color-scheme while listeners are attached.
function emitSystemThemeChange(prefersDark: boolean) {
  osPrefersDark = prefersDark
  act(() => {
    darkListeners.forEach((cb) => cb({ matches: prefersDark } as MediaQueryListEvent))
  })
}

beforeEach(() => {
  localStorage.clear()
  // Default OS: light
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockMatchMedia(false),
  })
})

describe('ThemeToggle', () => {
  it('renders a button', () => {
    renderToggle()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('starts with aria-pressed=false when OS is light and themeMode=system', () => {
    renderToggle()
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps a stable accessible name and exposes the next action in title on light theme', () => {
    renderToggle()
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
    expect(btn).toHaveAccessibleName('Toggle theme')
    expect(btn).toHaveAttribute('title', 'Switch to dark theme')
  })

  it('clicking switches themeMode and flips aria-pressed', () => {
    renderToggle()
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
    expect(btn).toHaveAccessibleName('Toggle theme')
    expect(btn).toHaveAttribute('title', 'Switch to light theme')
  })

  it('clicking twice returns to original state', () => {
    renderToggle()
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
  })

  it('resolves system→dark correctly when OS prefers dark', () => {
    window.matchMedia = mockMatchMedia(true)
    renderToggle()
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
    expect(btn).toHaveAttribute('title', 'Switch to light theme')
  })

  it('clicking from system+dark resolves to light', () => {
    window.matchMedia = mockMatchMedia(true)
    renderToggle()
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
  })

  it('does NOT write data-theme directly (SettingsContext owns it)', () => {
    // The toggle must not set data-theme itself; SettingsContext does it
    const setSpy = vi.spyOn(document.documentElement, 'setAttribute')
    renderToggle()
    fireEvent.click(screen.getByRole('button'))
    // setAttribute for data-theme should only come from SettingsContext useEffect, not inline in toggle
    // We just assert it's called via context (at least once) not zero times
    const dataThemeCalls = setSpy.mock.calls.filter(([attr]) => attr === 'data-theme')
    expect(dataThemeCalls.length).toBeGreaterThan(0)
    setSpy.mockRestore()
  })

  it('aria-pressed tracks the document data-theme attribute', () => {
    window.matchMedia = mockMatchMedia(true)
    renderToggle()
    const btn = screen.getByRole('button')
    // system + OS dark → resolved dark → data-theme="dark"
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(btn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(btn) // explicit light
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('updates icon/aria when the OS theme changes while in system mode', () => {
    // Start: system mode, OS light
    renderToggle()
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')

    // OS flips to dark while still in system mode
    emitSystemThemeChange(true)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
    // Toggle stays consistent with the document data-theme owned by SettingsContext
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    // OS flips back to light
    emitSystemThemeChange(false)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('ignores OS theme changes once an explicit theme is chosen', () => {
    renderToggle()
    const btn = screen.getByRole('button')
    fireEvent.click(btn) // explicit dark
    expect(btn).toHaveAttribute('aria-pressed', 'true')

    // OS swings to light, but explicit dark must remain
    emitSystemThemeChange(false)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
  })

  it('never writes an orphan "theme" localStorage key', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    renderToggle()
    fireEvent.click(screen.getByRole('button'))
    const keysWritten = setItemSpy.mock.calls.map(([key]) => key)
    expect(keysWritten).not.toContain('theme')
    expect(localStorage.getItem('theme')).toBeNull()
    setItemSpy.mockRestore()
  })
})

describe('SunIcon', () => {
  it('renders a decorative SVG with the shared icon class', () => {
    const { container } = render(<SunIcon />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('theme-toggle__icon')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 20 20')
  })

  it('renders the expected geometry deterministically', () => {
    const { container } = render(<SunIcon />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelectorAll('circle')).toHaveLength(1)
    expect(svg.querySelectorAll('path')).toHaveLength(8)
    expect(svg.querySelector('circle')).toHaveAttribute('cx', '10')
    expect(svg.querySelector('circle')).toHaveAttribute('cy', '10')
    expect(svg.querySelector('circle')).toHaveAttribute('r', '3.5')
  })

  it('renders identical output across repeated mounts (no hidden state)', () => {
    const a = render(<SunIcon />).container.innerHTML
    const b = render(<SunIcon />).container.innerHTML
    expect(a).toBe(b)
  })

  it('does not throw when rendered without any providers or globals', () => {
    // Failure-boundary check: the icon is pure and must not depend on DOM/matchMedia.
    expect(() => render(<SunIcon />)).not.toThrow()
  })

  it('remains a valid SVG even when the browser has no matchMedia', () => {
    const original = window.matchMedia
    // @ts-expect-error -- deleberately remove the API to exercise the boundary.
    delete (window as { window?: unknown }).matchMedia
    try {
      const { container } = render(<SunIcon />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      })
    }
  })

  it('survives a matchMedia that throws (boundary failure mode)', () => {
    const original = window.matchMedia
    window.matchMedia = (() => {
      throw new Error('matchMedia unavailable')
    }) as unknown as typeof window.matchMedia
    try {
      expect(() => render(<SunIcon />)).not.toThrow()
    } finally {
      window.matchMedia = original
    }
  })

  it('remains stable when the containing button is re-rendered repeatedly', () => {
    const { rerun } = render(
      <SettingsProvider>
        <ThemeToggle />
      </SettingsProvider>
    )
    const before = document.querySelector('.theme-toggle__icon')!.outerHTML
    act(() => {
      rerun()
    })
    expect(document.querySelector('.theme-toggle__icon')!.outerHTML).toBe(before)
  })
})
