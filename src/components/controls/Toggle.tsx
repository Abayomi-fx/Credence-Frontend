import { useId } from 'react'
import './controls.css'

interface ToggleProps {
  id?: string
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
  disabled?: boolean
  isLoading?: boolean
  error?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-required'?: boolean | 'true' | 'false'
}

/**
 * A controlled on/off switch.
 *
 * State model — every prop below is supplied by the caller; Toggle never holds
 * its own mutable state. That is what makes a failed or in-flight write safe:
 * the switch keeps reporting the last *committed* value instead of optimistically
 * flipping and drifting out of sync with the server.
 *
 * Invariants (enforced here, asserted in Toggle.test.tsx / Toggle.stories.test.tsx):
 *
 *  1. `isLoading` implies non-interactive. `disabled` and `isLoading` are
 *     OR-ed, so a pending write can never be clicked through. This is what
 *     makes retries idempotent: a second click cannot race a slow first one.
 *  2. `error` outranks `aria-invalid`. A truthy `error` always wins, even
 *     against an explicit `aria-invalid={false}`, so validation state can never
 *     be silently downgraded by a stale prop.
 *  3. `error` is never silent. The message is rendered in a `role="alert"`
 *     node and linked via `aria-describedby`; an error with no accessible text
 *     is not a diagnosable error.
 *  4. Caller `aria-describedby` is preserved. A caller-supplied id list (e.g.
 *     the one `FormField` injects) is appended to, never replaced, so wrapping
 *     this in a `FormField` keeps working.
 *  5. `checked` is the single source of truth. A click emits `!checked` and
 *     changes nothing locally; if the write fails the parent re-renders the
 *     previous value and the UI snaps back rather than showing a phantom state.
 *
 * `error` is the only prop that renders extra DOM. Callers that pre-validate
 * and already own their own message can pass `aria-invalid` and leave `error`
 * unset, which renders exactly the markup this component shipped before.
 */
export default function Toggle({
  id,
  checked,
  onChange,
  ariaLabel,
  disabled,
  isLoading,
  error,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: ToggleProps) {
  // Invariant 1: a pending write is never interactive, regardless of `disabled`.
  const isDisabled = disabled || isLoading
  // Invariant 2: a truthy `error` always wins. An empty string is "no error",
  // so callers can pass a computed message without branching on undefined.
  const isInvalid = !!error || ariaInvalid === true || ariaInvalid === 'true'

  // Invariant 4: the generated id is derived from React's tree-scoped useId and
  // never from the caller's `id`. `FormField` builds its own `${id}-error`, so
  // deriving ours from `id` too would emit two elements with the same DOM id.
  const errorId = useId()

  // Invariants 3 + 4: link the message without dropping a caller-supplied list.
  const describedBy =
    [ariaDescribedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={`control-toggle-wrapper ${isLoading ? 'control-toggle-wrapper--loading' : ''}`}>
      <button
        id={id}
        className={`control-toggle ${isInvalid ? 'control-toggle--error' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-invalid={isInvalid ? 'true' : undefined}
        aria-describedby={describedBy}
        aria-required={ariaRequired}
        aria-busy={isLoading || undefined}
        disabled={isDisabled}
        onClick={() => onChange(!checked)}
      >
        {isLoading ? (
          <span className="control-toggle-spinner" aria-hidden="true" />
        ) : checked ? (
          'On'
        ) : (
          'Off'
        )}
      </button>

      {/*
        Invariant 3, loading half. The spinner above is aria-hidden and replaces
        the "On"/"Off" label, so without this region a screen reader gets no
        signal that the control is mid-write — it would read as a bare switch.
        Rendered outside the button so it cannot leak into the accessible name.
      */}
      {isLoading && (
        <span className="sr-only" role="status" aria-live="polite">
          Saving setting
        </span>
      )}

      {error && (
        <span id={errorId} className="control-toggle__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
