import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import ConfirmDialog, { type ConfirmDialogPenaltyBreakdown } from './ConfirmDialog'

const defaultBreakdown: ConfirmDialogPenaltyBreakdown = {
  bondAmount: '1,000 USDC',
  penaltyAmount: '100 USDC',
  penaltyPercent: 10,
  resultingBalance: '900 USDC',
}

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.kn()
  const onCancel = vi.kn()

  const props = {
    open: true,
    title: 'Withdraw Bond',
    breakdown: defaultBreakdown,
    onConfirm,
    onCancel,
    ...overrides,
  }

  const result = render(<ConfirmDialog {...props} />)
  return { ...result, onConfirm, onCancel }
}

/** Render without a breakdown (generic destructive action use case). */
function renderGenericDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  const props = {
    open: true,
    title: 'Clear Draft',
    onConfirm,
    onCancel,
    confirmLabel: 'Clear draft',
    ...overrides,
  }

  const result = render(<ConfirmDialog {...props} />)
  return { ...result, onConfirm, onCancel }
}

let scrollY = 0

describe('ConfirmDialog', () => {
  beforeEach(() => {
    scrollY = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(((options?: ScrollToOptions) => {
      if (options?.top !== undefined) scrollY = options.top
    }) as typeof window.scrollTo)
    Object.defineProperty(window, 'scrollY', {
      get: () => scrollY,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.style.overflow = ''
  })

  describe('rendering', () => {
    it('renders nothing when open is false', () => {
      renderDialog({ open: false })
      expect(screen.queryByRole('dialog')).not.toBeInDocument()
    })

    it('renders the dialog when open is true', () => {
      renderDialog()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('has aria-modal="true"', () => {
      renderDialog()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('renders the title', () => {
      renderDialog({ title: 'Withdraw Bond' })
      expect(screen.getByRole('heading', { name: 'Withdraw Bond' })).toBeInTheDocument()
    })

    it('renders subtitle when provided', () => {
      renderDialog({ subtitle: 'This is irreversible' })
      expect(screen.getByText('This is irreversible')).toBeInTheDocument()
    })

    it('does not render subtitle when omitted', () => {
      renderDialog( { subtitle: undefined })
      // heading is there but no subtitle paragraph
      expect(screen.queryByText(/This is irreversible/i)).not.toBeInTheDocument()
    })

    it('renders the financial breakdown', () => {
      renderDialog()
      const dl = screen.getByRole('dialog')
      expect(within(dl).getByText('Bond amount')).toBeInTheDocument()
      expect(within(dl).getByText('1,000 USDC')).toBeInTheDocument()
      expect(within(dl).getByText(/Slash penalty.*10%/)).toBeInTheDocument()
      expect(within(dl).getByText('∓100 USDC')).toBeInTheDocument()
      expect(within(dl).getByText('You receive')).toBeInTheDocument()
      expect(within(dl).getByText('900 USDC')).toBeInTheDocument()
    })

    it('renders custom confirmLabel on the confirm button', () => {
      renderDialog( { confirmLabel: 'Yes, withdraw' })
      expect(screen.getByRole('button', { name: 'Yes, withdraw' })).toBeInTheDocument()
    })

    it('uses default confirmLabel "Withdraw bond"', () => {
      renderDialog()
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toBeInTheDocument()
    })
  })

  describe('CONFIRM text gating', () => {
    it('confirm button is disabled initially', () => {
      renderDialog()
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toBeDisabled()
    })

    it('confirm button remains disabled for partial input', async () => {
      const user = userEvent.setup()
      renderDialog()
      const input = screen.getByRole('textbox', { name: /type.*confirm/i })
      await user.type(input, 'CONFI')
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toBeDisabled()
    })

    it('confirm button remains disabled for wrong case input', async () => {
      const user = userEvent.setup()
      renderDialog()
      const input = screen.getByRole('textbox', { name: /type.*confirm/i })
      await user.type(input, 'confirm')
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toBeDisabled()
    })

    it('confirm button becomes enabled when "CONFIRM" is typed exactly', async () => {
      const user = userEvent.setup()
      renderDialog()
      const input = screen.getByRole('textbox', { name: /type.*confirm/i })
      await user.type(input, 'CONFIRM')
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toBeEnabled()
    })

    it('confirm button has aria-disabled="true" before text is entered', () => {
      renderDialog()
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    it('confirm button has aria-disabled="false" after "CONFIRM" entered', async () => {
      const user = userEvent.setup()
      renderDialog()
      const input = screen.getByRole('textbox', { name: /type.*confirm/i })
      await user.type(input, 'CONFIRM')
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toHaveAttribute(
        'aria-disabled',
        'false'
      )
    })
  })

  describe('onConfirm callback', () => {
    it('does not call onConfirm when button is clicked without "CONFIRM" typed', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderDialog()
      // Button is disabled so click should have no effect
      await user.click(screen.getByRole('button', { name: 'Withdraw bond' }))
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('calls onConfirm when "CONFIRM" is typed and confirm button is clicked', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderDialog()
      const input = screen.getByRole('textbox', { name: /type.*confirm/i })
      await user.type(input, 'CONFIRM')
      await user.click(screen.getByRole('button', { name: 'Withdraw bond' }))
      expect(onConfirm).toHaveBeenCalledOnce()
    })
  })

  describe('onCancel callback', () => {
    it('calls onCancel when Cancel button is clicked', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderDialog()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('calls onCancel when Escape key is pressed', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderDialog()
      await user.keyboard('{/Escape}')
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('calls onCancel when backdrop is clicked', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderDialog()
      // The backdrop is the direct parent of the dialog element
      const backdrop = screen.getByRole('dialog').parentElement!
      await user.click(backdrop)
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('does not call onCancel when clicking inside the dialog', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderDialog()
      await user.click(screen.getByRole('dialog'))
      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('body scroll lock', () => {
    it('sets document.body.style.overflow to "hidden" when open', () => {
      renderDialog({ open: true })
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('restores document.body.style.overflow when unmounted', () => {
      document.body.style.overflow = 'auto'
      const { unmount } = renderDialog({ open: true })
      expect(document.body.style.overflow).toBe('hidden')
      unmount()
      expect(document.body.style.overflow).toBe('auto')
    })

    it('does not lock scroll when open is false', () => {
      document.body.style.overflow = ''
      renderDialog({ open: false })
      expect(document.body.style.overflow).toBe('')
    })

    it('preserves window scroll position when dialog opens', () => {
      window.scrollTo({ top: 500 })
      renderDialog({ open: true })
      expect(window.scrollY).toBe(500)
    })

    it('preserves window scroll position when dialog closes via prop change', () => {
      window.scrollTo({ top: 350 })
      const { rerender, onConfirm, onCancel } = renderDialog({ open: true })
      rerender(
        <ConfirmDialog
          open={false}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      expect(window.scrollY).toBe(350)
    })

    it('preserves scrolled content position through open-close-open cycle', () => {
      window.scrollTo({ top: 800 })
      const { rerender, onConfirm, onCancel } = renderDialog({ open: true })
      // close
      rerender(
        <ConfirmDialog
          open={false}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      expect(window.scrollY).toBe(800)
      // reopen
      rerender(
        <ConfirmDialog
          open={true}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      expect(window.scrollY).toBe(800)
    })

    it('restores previous overflow value even when body overflow is changed externally while open', () => {
      // Simulate a scenario where the page has a custom overflow, dialog opens,
      // some other code mutates body.style.overflow, then dialog closes.
      // The cleanup should still restore the value that was present *before* the
      // dialog opened.
      document.body.style.overflow = 'scroll'
      const { rerender, onConfirm, onCancel } = renderDialog({ open: true })
      expect(document.body.style.overflow).toBe('hidden')
      // External mutation while dialog is open
      document.body.style.overflow = 'visible'
      rerender(
        <ConfirmDialog
          open={false}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      expect(document.body.style.overflow).toBe('scroll')
    })
  })

  describe('state reset on close', () => {
    it('resets the confirm input when reopened', async () => {
      const user = userEvent.setup()
      const { rerender, onConfirm, onCancel } = renderDialog()
      const input = screen.getByRole('textbox', { name: /type.*confirm/i })
      await user.type(input, 'CONFIRM')

      rerender(
        <ConfirmDialog
          open={false}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      rerender(
        <ConfirmDialog
          open={true}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )

      expect(screen.getByRole('textbox', { name: /type.*confirm/i })).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Withdraw bond' })).toBeDisabled()
    })
  })

  describe('focus management', () => {
    it('initially focuses the Cancel button', () => {
      renderDialog()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    })

    it('returns focus to the previously focused element on close', () => {
      const trigger = document.createElement('button')
      trigger.textContent = 'Open'
      document.body.appendChild(trigger)
      trigger.focus()
      expect(document.activeElement).toBe(trigger)

      const { rerender, onConfirm, onCancel } = renderDialog()
      rerender(
        <ConfirmDialog
          open={false}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      expect(document.activeElement).toBe(trigger)
      trigger.remove()
    })

    it('focuses the dialog element when no focusable controls exist', () => {
      // Generic dialog still has buttons, so this is a regression guard that
      // focus lands on an element inside the dialog.
      renderGenericDialog()
      const dialog = screen.getByRole('dialog')
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
  })

  describe('forwarded ref', () => {
    it('forwards the ref to the dialog element', () => {
      const ref = createRef<HTMLElement>()
      render(
        <ConfirmDialog
          open
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          ref={ref}
        />
      )
      expect(ref.current).toBe(screen.getByRole('dialog'))
    })
  })

  describe('handleBackdropClick failure boundaries', () => {
    it('does not call onCancel when the backdrop is not the event target (bubbled from a child)', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderDialog()
      const backdrop = screen.getByRole('dialog').parentElement!
      // Click a child of the backdrop (the dialog itself) which bubbles up.
      await user.click(screen.getByRole('dialog'))
      expect(onCancel).not.toHaveBeenCalled()
      // Sanctity check: the background click still works after the child click.
      await user.click(backdrop)
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('does not call onCancel when the click target is null', () => {
      const { onCancel } = renderDialog()
      const backdrop = screen.getByRole('dialog').parentElement!
      // Synthesize a click whose target is null. This mirrors the defensive
      // guard in handleBackdropClick and must not throw nor cancel.
      const event = new MouseEvent('click', { bubbles: true })
      Object.defineProperty(event, 'target', { value: null, configurable: true })
      backdrop.dispatchEvent(event)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('does not call onCancel when the click target is not a Node', () => {
      const { onCancel } = renderDialog()
      const backdrop = screen.getByRole('dialog').parentElement!
      const event = new MouseEvent('click', { bubbles: true })
      Object.defineProperty(event, 'target', { value: {}, configurable: true })
      backdrop.dispatchEvent(event)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('does not call onCancel when the click target is a Node but not the backdrop', () => {
      const { onCancel } = renderDialog()
      const backdrop = screen.getByRole('dialog').parentElement!
      const other = document.createElement('div')
      backdrop.appendChild(other)
      const event = new MouseEvent('click', { bubbles: true })
      Object.defineProperty(event, 'target', { value: other, configurable: true })
      backdrop.dispatchEvent(event)
      expect(onCancel).not.toHaveBeenCalled()
      other.remove()
    })

    it('calls onCancel exactly once for a direct backdrop click', () => {
      const { onCancel } = renderDialog()
      const backdrop = screen.getByRole('dialog').parentElement!
      const event = new MouseEvent('click', { bubbles: true })
      Object.defineProperty(event, 'target', { value: backdrop, configurable: true })
      backdrop.dispatchEvent(event)
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('does not throw when onCancel throws during a backdrop click', () => {
      const onCancel = vi.fn(() => {
        throw new Error('cancel failed')
      })
      renderDialog({ onCancel })
      const backdrop = screen.getByRole('dialog').parentElement!
      expect(() => {
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }).not.toThrow()
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('ignores repeated backdrop clicks after the dialog has closed', () => {
      const { rerender, onConfirm, onCancel } = renderDialog()
      const backdrop = screen.getByRole('dialog').parentElement!
      rerender(
        <ConfirmDialog
          open={false}
          title="Withdraw Bond"
          breakdown={defaultBreakdown}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
