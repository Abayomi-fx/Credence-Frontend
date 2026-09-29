import React, { Component, ReactNode } from 'react'
import { FormError } from './FormError'
import './FormField.css'

export type FormFieldState = 'default' | 'error' | 'success' | 'loading' | 'stale' | 'permission'

interface FormFieldErrorBoundaryProps {
  children: ReactNode
  onRetry?: () => void
  errorId?: string
}

interface FormFieldErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class FormFieldErrorBoundary extends Component<FormFieldErrorBoundaryProps, FormFieldErrorBoundaryState> {
  state: FormFieldErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): FormFieldErrorBoundaryState {
    return { hasError: true, error }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onRetry?.()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="form-field-boundary" role="alert" id={this.props.errorId}>
          <FormError id={this.props.errorId ? `${this.props.errorId}-boundary` : undefined}>
            An unexpected error occurred rendering this field.
          </FormError>
          <button type="button" onClick={this.handleRetry} className="form-field-retry-btn" aria-label="Retry loading field">
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface FormFieldProps {
  id: string
  label: string
  hint?: string
  error?: string
  /**
   * Inline confirmation message for a valid field.
   * Suppressed when `error` is set (error takes precedence).
   */
  success?: string
  
  /** Indicates the field is waiting for an asynchronous operation. */
  loading?: boolean
  /** Indicates the field's value may be out of date. */
  stale?: boolean
  /** Provide a string to show a permission warning, or boolean true for generic permission block. */
  permission?: string | boolean
  /** Callback for when the user asks to retry an operation (or recovering from an error boundary). */
  onRetry?: () => void

  /** When true, the label is visually hidden but remains linked to the control via htmlFor/id. */
  srOnlyLabel?: boolean
  /** Marks the field as required in the label and sets aria-required on the control. */
  required?: boolean
  className?: string
  children: React.ReactElement
}

export function FormField({
  id,
  label,
  hint,
  error,
  success,
  loading = false,
  stale = false,
  permission,
  onRetry,
  srOnlyLabel = false,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const successMessage = error ? undefined : success
  const successId = successMessage ? `${id}-success` : undefined
  
  const permissionMessage = typeof permission === 'string' ? permission : undefined
  const permissionId = permissionMessage ? `${id}-permission` : undefined

  const existingDescribedBy = children.props['aria-describedby'] as string | undefined

  let state: FormFieldState = 'default'
  if (error) state = 'error'
  else if (permission) state = 'permission'
  else if (loading) state = 'loading'
  else if (stale) state = 'stale'
  else if (successMessage) state = 'success'

  const rootClassName = ['form-field', className, loading ? 'is-loading' : undefined, stale ? 'is-stale' : undefined].filter(Boolean).join(' ')
  
  const isControlDisabled = loading || !!permission || children.props.disabled

  return (
    <div className={rootClassName} data-state={state} aria-busy={loading ? 'true' : undefined}>
      <label htmlFor={id} className={srOnlyLabel ? 'sr-only' : undefined}>
        {label}
        {required && !srOnlyLabel && (
          <span className="form-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>

      {hint && (
        <span id={hintId} className="form-hint">
          {hint}
        </span>
      )}
      
      {permissionMessage && (
        <span id={permissionId} className="form-permission" role="status">
          {permissionMessage}
        </span>
      )}

      <FormFieldErrorBoundary onRetry={onRetry} errorId={errorId ? `${errorId}-boundary` : `${id}-boundary`}>
        {React.cloneElement(children, {
          id,
          'aria-describedby':
            [existingDescribedBy, hintId, errorId, successId, permissionId].filter(Boolean).join(' ') || undefined,
          'aria-invalid': error ? 'true' : children.props['aria-invalid'],
          'aria-required': required ? 'true' : children.props['aria-required'],
          disabled: isControlDisabled ? true : undefined,
        })}
      </FormFieldErrorBoundary>

      {error && (
        <div className="form-error-container">
          <FormError id={errorId}>{error}</FormError>
          {onRetry && (
            <button type="button" onClick={onRetry} className="form-field-retry-btn" aria-label={`Retry ${label}`}>
              Retry
            </button>
          )}
        </div>
      )}

      {successMessage && (
        <span id={successId} className="form-success" role="status">
          <span aria-hidden="true">✓</span> {successMessage}
        </span>
      )}
    </div>
  )
}
