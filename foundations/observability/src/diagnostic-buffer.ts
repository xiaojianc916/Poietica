import type { LogContext, LogLevel } from './log'

export interface DiagnosticLogEntry {
  readonly sequence: number
  readonly timestamp: string
  readonly level: LogLevel
  readonly message: string
  readonly scope?: string
  readonly correlationId?: string
  readonly context: Readonly<Record<string, string>>
}

const DEFAULT_CAPACITY = 200
const MAX_MESSAGE_LENGTH = 2_000
const MAX_CONTEXT_ENTRIES = 32
const MAX_CONTEXT_VALUE_LENGTH = 4_000
const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|authorization|cookie|license|api[-_]?key|credential/i

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

const WINDOWS_USER_PATH_PATTERN = /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+/gi

const UNIX_USER_PATH_PATTERN = /\/(?:Users|home)\/[^/\s]+/gi

const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi

let capacity = DEFAULT_CAPACITY
let nextSequence = 1
let entries: DiagnosticLogEntry[] = []

export function recordDiagnosticLog(
  level: LogLevel,
  message: string,
  context: LogContext,
  timestamp: string,
): void {
  try {
    const scope = normalizeOptionalText(context.scope, 256)
    const correlationId = normalizeOptionalText(context.correlationId, 256)

    const entry: DiagnosticLogEntry = {
      sequence: nextSequence,
      timestamp: normalizeTimestamp(timestamp),
      level,
      message: normalizeText(message, MAX_MESSAGE_LENGTH),
      ...(scope === undefined ? {} : { scope }),
      ...(correlationId === undefined ? {} : { correlationId }),
      context: sanitizeContext(context),
    }

    nextSequence += 1
    entries.push(entry)

    if (entries.length > capacity) {
      entries = entries.slice(entries.length - capacity)
    }
  } catch (error: unknown) {
    // Observability must never become an application failure source.
    emergencyConsoleError('Failed to record diagnostic log entry', error)
  }
}

export function getRecentLogEntries(limit = capacity): readonly DiagnosticLogEntry[] {
  const normalizedLimit = Math.max(0, Math.min(Math.floor(limit), capacity))

  return entries.slice(Math.max(0, entries.length - normalizedLimit)).map(cloneEntry)
}

export function clearDiagnosticLogs(): void {
  entries = []
}

export function configureDiagnosticBuffer(options: { readonly capacity?: number }): void {
  if (options.capacity === undefined) {
    return
  }

  if (!Number.isInteger(options.capacity) || options.capacity < 1 || options.capacity > 2_000) {
    throw new RangeError('Diagnostic buffer capacity must be an integer between 1 and 2000.')
  }

  capacity = options.capacity

  if (entries.length > capacity) {
    entries = entries.slice(entries.length - capacity)
  }
}

export function formatDiagnosticLogs(logEntries: readonly DiagnosticLogEntry[]): string {
  return logEntries
    .map((entry) => {
      const prefix = [
        entry.timestamp,
        entry.level.toUpperCase(),
        entry.scope ? `[${entry.scope}]` : undefined,
        `#${String(entry.sequence)}`,
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')

      const contextEntries = Object.entries(entry.context)

      if (contextEntries.length === 0) {
        return `${prefix} ${entry.message}`
      }

      return [
        `${prefix} ${entry.message}`,
        ...contextEntries.map(([key, value]) => `  ${key}: ${value}`),
      ].join('\n')
    })
    .join('\n')
}

function sanitizeContext(context: LogContext): Readonly<Record<string, string>> {
  const sanitizedEntries = Object.entries(context)
    .filter(([key]) => key !== 'scope' && key !== 'correlationId')
    .slice(0, MAX_CONTEXT_ENTRIES)
    .map(([key, value]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, REDACTED] as const
      }

      return [key, normalizeText(serializeUnknown(value), MAX_CONTEXT_VALUE_LENGTH)] as const
    })

  return Object.fromEntries(sanitizedEntries)
}

function serializeUnknown(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  if (value === null) {
    return 'null'
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  if (typeof value === 'symbol') {
    return value.description ? `Symbol(${value.description})` : 'Symbol()'
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }

  const seen = new WeakSet<object>()

  try {
    return JSON.stringify(
      value,
      (_key, candidate: unknown) => {
        if (candidate instanceof Error) {
          return serializeError(candidate)
        }

        if (typeof candidate === 'object' && candidate !== null) {
          if (seen.has(candidate)) {
            return '[Circular]'
          }

          seen.add(candidate)
        }

        if (typeof candidate === 'bigint') {
          return String(candidate)
        }

        if (typeof candidate === 'symbol') {
          return String(candidate)
        }

        if (typeof candidate === 'function') {
          return `[Function ${candidate.name || 'anonymous'}]`
        }

        return candidate
      },
      2,
    )
  } catch {
    try {
      return String(value)
    } catch {
      return '[Unserializable value]'
    }
  }
}

function serializeError(error: Error): Readonly<Record<string, unknown>> {
  const cause = 'cause' in error ? error.cause : undefined

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause:
      cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            stack: cause.stack,
          }
        : cause,
  }
}

function cloneEntry(entry: DiagnosticLogEntry): DiagnosticLogEntry {
  return {
    ...entry,
    context: {
      ...entry.context,
    },
  }
}

function normalizeTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp)

  if (Number.isNaN(parsed)) {
    return new Date().toISOString()
  }

  return new Date(parsed).toISOString()
}

function normalizeOptionalText(
  value: string | undefined,
  maximumLength: number,
): string | undefined {
  if (!value) {
    return undefined
  }

  return normalizeText(value, maximumLength)
}

function normalizeText(value: string, maximumLength: number): string {
  const redacted = redactText(value)

  if (redacted.length <= maximumLength) {
    return redacted
  }

  return `${redacted.slice(0, maximumLength)}\n[Diagnostic value truncated]`
}

function redactText(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(WINDOWS_USER_PATH_PATTERN, `C:\\Users\\${REDACTED}`)
    .replace(UNIX_USER_PATH_PATTERN, `/Users/${REDACTED}`)
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED}:${REDACTED}@`)
}

function emergencyConsoleError(message: string, error: unknown): void {
  try {
    console.error(`[Hybrid Canvas Observability] ${message}`, error)
  } catch {
    // There is deliberately no further fallback.
  }
}
