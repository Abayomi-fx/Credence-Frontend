import React, { useState, useRef, useCallback } from 'react'
import { FormField } from './forms/FormField'
import './AddressInput.css'
import { useSettings } from '../context/SettingsContext'
import Banner from './Banner' // assuming Banner exists

interface AddressInputProps {
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  onValidationChange?: (isValid: boolean) => void
  onBlur?: (value: string) => Promise<void> | void
  disabled?: boolean
  className?: string
  /**
   * External validation message (e.g. required-on-submit).
   * Takes precedence over the built-in format error when provided.
   */
  error?: string
}

/**
 * Validates Stellar public key format.
 * Valid addresses: 56 characters, starts with 'G'
 */
function isValidStellarAddress(address: string): boolean {
  if (!address) return false
  // Stellar addresses are 56 characters and start with 'G'
  return /^G[A-Z0-9]{55}$/.test(address)
}

/**
 * Truncates address for display: shows first 12 and last 8 characters.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 20) return address
  return `${address.substring(0, 12)}...${address.substring(address.length - 8)}`
}

export type AddressDisplayMode = 'full' | 'short' | 'friendly'

/**
 * Formats an address for UI display based on the user's addressDisplay setting.
 *
 * Notes:
 * - `friendly` name resolution is not available yet. It falls back to `short`.
 * - This helper is intentionally pure and safe to call during render.
 */
export function formatAddressForDisplay(address: string, mode: AddressDisplayMode): string {
  switch (mode) {
    case 'full':
      return address
    case 'friendly':
      // TODO: Resolve friendly names when available on-chain.
      return truncateAddress(address)
    case 'short':
    default:
      return truncateAddress(address)
  }
}

/**
 * Internal component to handle prop injection from FormField
 */
interface AddressInputInnerProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: 'true' | 'false'
  inputRef: React.RefObject<HTMLInputElement>
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur: () => void
  onFocus: () => void
  disabled: boolean
  handlePaste: () => void
  focused: boolean
  showError: boolean
  showSuccess: boolean
  blurState: 'idle' | 'loading' | 'error' | 'stale' | 'permission'
}

function AddressInputInner({
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  inputRef,
  value,
  onChange,
  onBlur,
  onFocus,
  disabled,
  handlePaste,
  focused,
  showError,
  showSuccess,
  blurState,
}: AddressInputInnerProps) {
  return (
    <div
      className={`address-input-container ${focused ? 'address-input-container--focused' : ''} ${showError ? 'address-input-container--error' : ''} ${showSuccess ? 'address-input-container--success' : ''} ${blurState === 'loading' ? 'address-input-container--loading' : ''}`}
    >
      <input
        ref={inputRef}
        type="text"
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onFocus={onFocus}
        disabled={disabled || blurState === 'loading'}
        placeholder="Enter Stellar address (G...)"
        className="address-input-field"
        spellCheck="false"
        autoComplete="off"
        autoCapitalize="off"
      />

      {blurState === 'loading' ? (
        <span className="address-input-spinner" aria-label="Loading..." role="status" />
      ) : (
        <button
          type="button"
          onClick={handlePaste}
          disabled={disabled}
          className="address-input-paste-button"
          aria-label="Paste address from clipboard"
          title="Paste address from clipboard"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M10.5 1H5.5C4.67157 1 4 1.67157 4 2.5V3H2.5C1.67157 3 1 3.67157 1 4.5V13.5C1 14.3284 1.67157 15 2.5 15H10.5C11.3284 15 12 14.3284 12 13.5V12H13.5C14.3284 12 15 11.3284 15 10.5V2.5C15 1.67157 14.3284 1 13.5 1H10.5Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function AddressInput({
  id,
  label = 'Stellar Address',
  value,
  onChange,
  onValidationChange,
  onBlur,
  disabled = false,
  className = '',
  error: externalError,
}: AddressInputProps) {
  const { addressDisplay } = useSettings()

  const inputRef = useRef<HTMLInputElement>(null)

  const [focused, setFocused] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const [blurState, setBlurState] = useState<'idle' | 'loading' | 'error' | 'stale' | 'permission'>('idle')
  const [blurError, setBlurError] = useState<string | null>(null)
  
  const blurPromiseRef = useRef<Promise<void> | null>(null)
  const failedValueRef = useRef<string | null>(null)

  const isValid = isValidStellarAddress(value)
  const isEmpty = !value
  const showError = attempted && !isValid && !isEmpty
  const showSuccess = attempted && isValid && blurState !== 'error' && blurState !== 'permission' && blurState !== 'stale'

  // Notify parent of validation state change
  React.useEffect(() => {
    onValidationChange?.(isValid)
  }, [isValid, onValidationChange])

  const executeBlur = useCallback(async (valToValidate: string) => {
    if (!onBlur) return
    
    setBlurState('loading')
    setBlurError(null)
    
    const currentPromise = Promise.resolve(onBlur(valToValidate))
    blurPromiseRef.current = currentPromise
    
    try {
      await currentPromise
      if (blurPromiseRef.current !== currentPromise) return
      
      setBlurState('idle')
      failedValueRef.current = null
    } catch (err: any) {
      if (blurPromiseRef.current !== currentPromise) return
      
      failedValueRef.current = valToValidate
      const isPermission = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.message?.toLowerCase().includes('permission')
      const isStale = err?.name === 'StaleError' || err?.message?.toLowerCase().includes('stale')
      
      if (isPermission) {
        setBlurState('permission')
      } else if (isStale) {
        setBlurState('stale')
      } else {
        setBlurState('error')
      }
      setBlurError(err?.message || 'Validation failed on blur')
    }
  }, [onBlur])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    // Mark as attempted if user starts typing
    if (!attempted) {
      setAttempted(true)
    }
    // Reset async error state if user changes input
    if (blurState !== 'idle' && blurState !== 'loading') {
       setBlurState('idle')
       setBlurError(null)
    }
  }

  const handleBlurEvent = () => {
    setFocused(false)
    setAttempted(true)
    executeBlur(value)
  }

  const handleFocus = () => {
    setFocused(true)
  }

  const handleRetry = () => {
    if (failedValueRef.current !== null) {
      executeBlur(failedValueRef.current)
    } else {
      executeBlur(value)
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const trimmedText = text.trim()
      onChange(trimmedText)
      setAttempted(true)
      
      if (blurState !== 'idle' && blurState !== 'loading') {
         setBlurState('idle')
         setBlurError(null)
      }

      // Focus the input after paste
      if (inputRef.current) {
        inputRef.current.focus()
      }
    } catch {
      // Clipboard API not available or permission denied
      // Fallback: focus input for manual paste
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }
  }

  const formatError = showError
    ? 'Invalid address. Stellar public keys are 56 characters starting with G.'
    : undefined
  const error = externalError ?? formatError
  const hint = 'Stellar public key format (56 characters, starts with G)'
  // Visual + FormField success only when format is valid and no external error.
  const successMessage = !externalError && showSuccess && blurState === 'idle' ? 'Valid Stellar address' : undefined

  return (
    <div className={`address-input-wrapper ${className}`}>
      <FormField
        id={id}
        label={label}
        hint={hint}
        error={error}
        success={successMessage}
      >
        <AddressInputInner
          inputRef={inputRef}
          value={value}
          onChange={handleChange}
          onBlur={handleBlurEvent}
          onFocus={handleFocus}
          disabled={disabled}
          handlePaste={handlePaste}
          focused={focused}
          showError={Boolean(error)}
          showSuccess={Boolean(successMessage)}
          blurState={blurState}
        />
      </FormField>
      
      {blurState === 'permission' && (
        <div className="address-input-blur-error" role="alert" style={{ marginTop: '0.5rem', color: 'var(--color-error)' }}>
          <strong>Permission Denied:</strong> {blurError}
          <button type="button" onClick={handleRetry} style={{ marginLeft: '1rem', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      
      {blurState === 'stale' && (
        <div className="address-input-blur-error" role="alert" style={{ marginTop: '0.5rem', color: 'var(--color-warning)' }}>
          <strong>Stale Data:</strong> {blurError}
          <button type="button" onClick={handleRetry} style={{ marginLeft: '1rem', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      
      {blurState === 'error' && (
        <div className="address-input-blur-error" role="alert" style={{ marginTop: '0.5rem', color: 'var(--color-error)' }}>
          <strong>Error:</strong> {blurError}
          <button type="button" onClick={handleRetry} style={{ marginLeft: '1rem', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      {/* Address echo display when valid */}
      {showSuccess && value && (
        <div className="address-input-echo">
          <span className="address-input-echo-label">Recognized:</span>
          <code className="address-input-echo-value">
            {formatAddressForDisplay(value, addressDisplay as AddressDisplayMode)}
          </code>
        </div>
      )}

      {/* Character count hint */}
      {value && <div className="address-input-count">{value.length} / 56 characters</div>}
    </div>
  )
}
