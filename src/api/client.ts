import { ApiRateLimiter, DEFAULT_API_RATE_LIMIT, readApiRateLimitOverrides } from './rateLimit'
import { emitWalletSessionEvent, generateCorrelationId } from '../lib/walletAudit'
import { AmountError, parseAmount, type AmountErrorCode, type AmountRules } from './amount'

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown> | unknown[] | null
  /** Stable key for retrying one state-changing operation safely. */
  idempotencyKey?: string
  /** When true, bypasses the client-side rate limiter for this call only. */
  skipRateLimit?: boolean
  /** Declares decimal amount fields within the request JSON body. */
  amountFields?: ApiAmountFields
  /** Identity epoch captured at the moment the caller reads the identity it intends to act on. */
  identityEpoch?: number
}

/** Machine-readable classification for API failures. */
export type ApiErrorCode = 'invalid_request_url' | 'network_error' | 'http_error'

/** Amount-field declarations allowed by the JSON-boundary gate. */
export type ApiAmountFields = string[] | Record<string, AmountRules | true>

/** Rejection reasons for declared amount fields. */
export type ApiAmountErrorCode = AmountErrorCode | 'INVALID_BODY' | 'MISSING'

export class ApiError extends Error {
  readonly status: number
  readonly payload: unknown
  readonly code?: ApiErrorCode

  constructor(status: number, message: string, payload?: unknown, code?: ApiErrorCode) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
    this.code = code
  }
}

export class ApiRateLimitError extends ApiError {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number, message = 'Too many requests', payload?: unknown) {
    super(429, message, payload, 'http_error')
    this.name = 'ApiRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export class ApiAmountError extends ApiError {
  readonly field: string | null
  readonly code: ApiAmountErrorCode

  constructor(field: string | null, code: ApiAmountErrorCode, message: string) {
    super(400, message, { field, code }, 'http_error')
    this.name = 'ApiAmountError'
    this.field = field
    this.code = code
  }
}

export class ApiSessionConflictError extends ApiError {
  readonly staleEpoch: number
  readonly currentEpoch: number

  constructor(staleEpoch: number, currentEpoch: number, message?: string) {
    super(
      409,
      message ??
        `Session identity changed during request (epoch ${staleEpoch} → ${currentEpoch}). Re-authenticate and retry.`,
      { staleEpoch, currentEpoch },
      'http_error'
    )
    this.name = 'ApiSessionConflictError'
    this.staleEpoch = staleEpoch
    this.currentEpoch = currentEpoch
  }
}

export class ApiBodyTooLargeError extends ApiError {
  readonly limitBytes: number
  readonly bodySizeBytes: number

  constructor(limitBytes: number, payload?: { bodySize: number }) {
    super(413, `Request body too large (limit ${limitBytes} bytes).`, payload ?? { limitBytes }, 'http_error')
    this.name = 'ApiBodyTooLargeError'
    this.limitBytes = limitBytes
    this.bodySizeBytes = payload?.bodySize ?? 0
  }
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const IS_DEV = env?.PROD !== true

const DIAGNOSTIC_PATH_MAX_LENGTH = 80
const LAST_C0_CODE = 0x1f
const DEL_CODE = 0x7f
const LAST_C1_CODE = 0x9f

export const MAX_REQUEST_BODY_BYTES = 1_048_576

function isControlCode(code: number): boolean {
  return code <= LAST_C0_CODE || (code >= DEL_CODE && code <= LAST_C1_CODE)
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isControlCode(value.charCodeAt(index))) return true
  }
  return false
}

function replaceControlCharacters(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    result += isControlCode(value.charCodeAt(index)) ? '?' : value[index]
  }
  return result
}

function rejectBaseUrl(): '' {
  if (IS_DEV) {
    console.warn(
      '[api] VITE_API_BASE_URL is not a supported API base. Expected an empty value, ' +
        'a root-relative prefix (e.g. "/api"), or an absolute http(s) origin. Falling back to same-origin requests.'
    )
  }
  return ''
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || trimmed === '/') return ''

  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return rejectBaseUrl()
  if (trimmed.startsWith('/')) {
    if (trimmed.includes('?') || trimmed.includes('#')) return rejectBaseUrl()
    return trimmed.replace(/\/+$/, '')
  }

  if (!/^https?:\/\//i.test(trimmed)) return rejectBaseUrl()

  try {
    const parsed = new URL(trimmed)
    if (parsed.search || parsed.hash) return rejectBaseUrl()
    return trimmed.replace(/\/+$/, '')
  } catch {
    return rejectBaseUrl()
  }
}

export const API_BASE_URL = normalizeBaseUrl(env?.VITE_API_BASE_URL || '/api')

function redactPathForDiagnostics(value: unknown): string {
  if (typeof value !== 'string') return typeof value
  const queryStart = value.indexOf('?')
  const pathOnly = queryStart === -1 ? value : value.slice(0, queryStart)
  const fragmentIndex = pathOnly.indexOf('#')
  const sansFragment = fragmentIndex === -1 ? pathOnly : pathOnly.slice(0, fragmentIndex)
  const printable = replaceControlCharacters(sansFragment)
  const clipped =
    printable.length > DIAGNOSTIC_PATH_MAX_LENGTH
      ? `${printable.slice(0, DIAGNOSTIC_PATH_MAX_LENGTH)}…`
      : printable
  const hasQuery = queryStart !== -1
  return hasQuery ? `${clipped}?<redacted>` : clipped
}

type PathRejection =
  | 'path must be a string'
  | 'path must not be empty'
  | 'path must be relative, not origin-relative'
  | 'path must not contain backslashes'
  | 'path must not contain control characters'
  | 'path must not contain a URL fragment'

function invalidPathError(reason: PathRejection, path: unknown): ApiError {
  return new ApiError(
    0,
    `Invalid API request path: ${reason}`,
    { code: 'invalid_request_url', reason, path: redactPathForDiagnostics(path) },
    'invalid_request_url'
  )
}

function normalizeApiPath(path: string): string {
  if (typeof path !== 'string') {
    throw invalidPathError('path must be a string', path)
  }

  const trimmed = path.trim()
  if (!trimmed) throw invalidPathError('path must not be empty', path)
  if (trimmed.startsWith('//')) {
    throw invalidPathError('path must be relative, not origin-relative', path)
  }
  if (trimmed.includes('\\')) {
    throw invalidPathError('path must not contain backslashes', path)
  }
  if (hasControlCharacters(trimmed)) {
    throw invalidPathError('path must not contain control characters', path)
  }
  if (trimmed.includes('#')) {
    throw invalidPathError('path must not contain a URL fragment', path)
  }

  return `/${trimmed.replace(/^\/+/, '')}`
}

export function buildUrl(path: string, baseUrl: string = API_BASE_URL): string {
  return `${normalizeBaseUrl(baseUrl)}${normalizeApiPath(path)}`
}

function isJsonBody(body: ApiFetchOptions['body']): body is Record<string, unknown> | unknown[] {
  return (
    Boolean(body) &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}

function normalizeAmountFields(
  amountFields: ApiAmountFields | undefined
): Array<[string, AmountRules | undefined]> {
  if (!amountFields) return []
  if (Array.isArray(amountFields)) {
    return amountFields.map((field): [string, AmountRules | undefined] => [field, undefined])
  }
  return Object.entries(amountFields).map(([field, rules]): [string, AmountRules | undefined] => [
    field,
    rules === true ? undefined : rules,
  ])
}

function applyAmountFields(
  body: ApiFetchOptions['body'],
  amountFields: ApiAmountFields | undefined
): ApiFetchOptions['body'] {
  const fields = normalizeAmountFields(amountFields)
  if (fields.length === 0) return body

  if (!isJsonBody(body) || Array.isArray(body)) {
    throw new ApiAmountError(
      null,
      'INVALID_BODY',
      'amountFields requires a JSON object body (object bodies only; arrays and streaming bodies are not supported).'
    )
  }

  const record = body as Record<string, unknown>
  const wireBody: Record<string, unknown> = { ...record }

  for (const [field, rules] of fields) {
    const hasField = Object.prototype.hasOwnProperty.call(record, field)
    const value = record[field]
    if (!hasField || value === undefined) {
      throw new ApiAmountError(field, 'MISSING', `Declared amount field "${field}" is missing or undefined.`)
    }
    try {
      wireBody[field] = parseAmount(value as string | number | bigint, rules)
    } catch (error) {
      if (error instanceof AmountError) {
        throw new ApiAmountError(field, error.code as ApiAmountErrorCode, `Invalid amount for field "${field}": ${error.message}`)
      }
      throw error
    }
  }

  return wireBody
}

function buildHeaders(headers: HeadersInit | undefined, hasJsonBody: boolean, correlationId?: string): Headers {
  const nextHeaders = new Headers(headers)
  if (!nextHeaders.has('Accept')) nextHeaders.set('Accept', 'application/json')
  if (hasJsonBody && !nextHeaders.has('Content-Type')) nextHeaders.set('Content-Type', 'application/json')
  if (correlationId && !nextHeaders.has('X-Correlation-ID')) nextHeaders.set('X-Correlation-ID', correlationId)
  return nextHeaders
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()

  const text = await response.text()
  return text || undefined
}

function errorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message
  }
  if (typeof payload === 'string' && payload.trim()) return payload
  return `Request failed with status ${status}`
}

function requestFingerprint(
  url: string,
  init: RequestInit,
  serializedBody: BodyInit | undefined,
  headers: Headers
): string {
  const comparableHeaders: string[] = []
  headers.forEach((value, name) => {
    const lowerName = name.toLowerCase()
    if (lowerName !== 'idempotency-key' && lowerName !== 'x-correlation-id') {
      comparableHeaders.push(`${lowerName}:${value}`)
    }
  })

  return JSON.stringify([
    url,
    init.method || 'GET',
    comparableHeaders.join('\n'),
    serializedBody ?? null,
  ])
}

function replayConflict(key: string): ApiError {
  return new ApiError(409, `Idempotency key has already been used for a different operation: ${key}`, {
    code: 'idempotency_key_conflict',
  })
}

const replayEntries = new Map<string, { fingerprint: string; promise: Promise<unknown> }>()

let _identityEpoch = 0

export function getIdentityEpoch(): number {
  return _identityEpoch
}

export function advanceIdentityEpoch(): number {
  _identityEpoch += 1
  return _identityEpoch
}

export function setIdentityEpoch(epoch?: number): number {
  _identityEpoch = epoch ?? _identityEpoch + 1
  return _identityEpoch
}

export function resetIdentityEpoch(): void {
  _identityEpoch = 0
}

const rateLimitOverrides = readApiRateLimitOverrides({
  VITE_API_RATE_LIMIT_MAX: env?.VITE_API_RATE_LIMIT_MAX,
  VITE_API_RATE_LIMIT_WINDOW_MS: env?.VITE_API_RATE_LIMIT_WINDOW_MS,
  VITE_API_RATE_LIMIT_ENABLED: env?.VITE_API_RATE_LIMIT_ENABLED,
})

export const defaultApiRateLimiter = new ApiRateLimiter({
  maxRequests: rateLimitOverrides.maxRequests ?? DEFAULT_API_RATE_LIMIT.maxRequests,
  windowMs: rateLimitOverrides.windowMs ?? DEFAULT_API_RATE_LIMIT.windowMs,
  enabled: rateLimitOverrides.enabled ?? DEFAULT_API_RATE_LIMIT.enabled,
})

export function apiRateLimiterSnapshot(): Readonly<{
  maxRequests: number
  windowMs: number
  enabled: boolean
}> {
  const cfg = defaultApiRateLimiter.config
  return Object.freeze({
    maxRequests: cfg.maxRequests,
    windowMs: cfg.windowMs,
    enabled: cfg.enabled,
  })
}

export function resetApiRateLimiter(): void {
  defaultApiRateLimiter.reset()
}

interface ApiFetchContext {
  correlationId: string
  path: string
  method: string
  skipRateLimit?: boolean
  identityEpoch?: number
}

async function apiFetchWithoutReplay<T>(
  url: string,
  init: RequestInit,
  headers: Headers,
  serializedBody: BodyInit | undefined,
  ctx: ApiFetchContext
): Promise<T> {
  if (!ctx.skipRateLimit) {
    const decision = defaultApiRateLimiter.acquire()
    if (!decision.allowed) {
      throw new ApiRateLimitError(
        decision.retryAfterMs,
        `Too many requests, retry in ${decision.retryAfterMs}ms`,
        { retryAfterMs: decision.retryAfterMs }
      )
    }
  }

  if (ctx.identityEpoch !== undefined && ctx.identityEpoch !== _identityEpoch) {
    throw new ApiSessionConflictError(
      ctx.identityEpoch,
      _identityEpoch,
      `Session identity changed before request was dispatched (epoch ${ctx.identityEpoch} → ${_identityEpoch}).`
    )
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers,
      body: serializedBody,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      emitWalletSessionEvent('action_failed', {
        address: null,
        network: null,
        correlationId: ctx.correlationId,
        metadata: { path: ctx.path, method: ctx.method, aborted: true },
      })
      throw error
    }

    const message = error instanceof Error ? error.message : 'Network request failed'
    emitWalletSessionEvent('action_failed', {
      address: null,
      network: null,
      correlationId: ctx.correlationId,
      metadata: { path: ctx.path, method: ctx.method, status: 0, message },
    })
    throw new ApiError(0, message, error, 'network_error')
  }

  if (ctx.identityEpoch !== undefined && ctx.identityEpoch !== _identityEpoch) {
    throw new ApiSessionConflictError(
      ctx.identityEpoch,
      _identityEpoch,
      `Session identity changed while request was in-flight (epoch ${ctx.identityEpoch} → ${_identityEpoch}). Response discarded.`
    )
  }

  const payload = await parseResponse(response)

  if (!response.ok) {
    const message = errorMessage(response.status, payload)
    emitWalletSessionEvent('action_failed', {
      address: null,
      network: null,
      correlationId: ctx.correlationId,
      metadata: { path: ctx.path, method: ctx.method, status: response.status, message },
    })
    throw new ApiError(response.status, message, payload, 'http_error')
  }

  emitWalletSessionEvent('action_succeeded', {
    address: null,
    network: null,
    correlationId: ctx.correlationId,
    metadata: { path: ctx.path, method: ctx.method, status: response.status },
  })

  return payload as T
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, headers, skipRateLimit, amountFields, idempotencyKey, identityEpoch, ...init } = options

  const wireBody = applyAmountFields(body, amountFields)
  const hasJsonBody = isJsonBody(wireBody)

  let serializedBody: BodyInit | undefined
  try {
    serializedBody = hasJsonBody ? JSON.stringify(wireBody) : (wireBody as BodyInit | undefined)
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw error
  }

  const url = buildUrl(path)
  const requestHeaders = buildHeaders(headers, hasJsonBody, generateCorrelationId('api-fetch'))
  const method = (init.method || 'GET').toUpperCase()

  if (hasJsonBody) {
    const serialized = JSON.stringify(wireBody)
    if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new ApiBodyTooLargeError(MAX_REQUEST_BODY_BYTES, { bodySize: serialized.length })
    }
  }

  if (idempotencyKey !== undefined) {
    const normalizedKey = idempotencyKey.trim()
    if (!normalizedKey) {
      throw new ApiError(400, 'Idempotency key must not be empty', { code: 'invalid_idempotency_key' })
    }

    const existing = replayEntries.get(normalizedKey)
    const fingerprint = requestFingerprint(url, { ...init, method }, serializedBody, requestHeaders)

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw replayConflict(normalizedKey)
      }
      return existing.promise as Promise<T>
    }

    requestHeaders.set('Idempotency-Key', normalizedKey)
    const requestPromise = apiFetchWithoutReplay<T>(url, { ...init, method }, requestHeaders, serializedBody, {
      correlationId: requestHeaders.get('X-Correlation-ID') || generateCorrelationId('api-fetch'),
      path,
      method,
      skipRateLimit,
      identityEpoch,
    })

    replayEntries.set(normalizedKey, { fingerprint, promise: requestPromise })
    requestPromise.catch(() => {
      if (replayEntries.get(normalizedKey)?.promise === requestPromise) {
        replayEntries.delete(normalizedKey)
      }
    })
    return requestPromise
  }

  if (serializedBody !== undefined && hasJsonBody) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  return apiFetchWithoutReplay<T>(url, { ...init, method }, requestHeaders, serializedBody, {
    correlationId: requestHeaders.get('X-Correlation-ID') || generateCorrelationId('api-fetch'),
    path,
    method,
    skipRateLimit,
    identityEpoch,
  })
}
