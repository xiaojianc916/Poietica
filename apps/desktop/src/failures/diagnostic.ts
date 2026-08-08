import {
  type DiagnosticLogEntry,
  formatDiagnosticLogs,
  getRecentLogEntries,
  optionalProperty,
} from '@poietica/core'

export interface FailureDiagnosticHint {
  readonly componentStack?: string | null

  readonly source?: string
  readonly line?: number
  readonly column?: number
}

export interface FailureDiagnostic {
  readonly errorName: string
  readonly stack?: string
  readonly componentStack?: string

  readonly source?: string
  readonly line?: number
  readonly column?: number

  readonly pageUrl: string
  readonly userAgent: string

  readonly recentLogs: readonly DiagnosticLogEntry[]
}

interface NormalizedCause {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

const REDACTED = '[REDACTED]'
const MAX_MESSAGE_LENGTH = 4_000
const MAX_STACK_LENGTH = 32_000

const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|license|api[-_]?key/i

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

const WINDOWS_USER_PATH_PATTERN = /[A-Za-z]:\\Users\\[^\\\s]+/gi

const UNIX_USER_PATH_PATTERN = /\/(?:Users|home)\/[^/\s]+/gi

export function normalizeFailureCause(cause: unknown): NormalizedCause {
  if (cause instanceof Error) {
    return {
      name: cause.name || 'Error',

      message: normalizeText(cause.message || 'Unknown error', MAX_MESSAGE_LENGTH),

      ...optionalProperty('stack', normalizeOptionalText(cause.stack, MAX_STACK_LENGTH)),
    }
  }

  if (typeof cause === 'string') {
    return {
      name: 'Error',
      message: normalizeText(cause || 'Unknown error', MAX_MESSAGE_LENGTH),
    }
  }

  return {
    name: 'UnknownError',
    message: normalizeText(safeStringify(cause), MAX_MESSAGE_LENGTH),
  }
}

export function createFailureDiagnostic(
  cause: unknown,
  hint: FailureDiagnosticHint = {},
): FailureDiagnostic {
  const normalized = normalizeFailureCause(cause)

  return Object.freeze({
    errorName: normalized.name,

    ...optionalProperty('stack', normalized.stack),

    ...optionalProperty(
      'componentStack',
      normalizeOptionalText(hint.componentStack ?? undefined, MAX_STACK_LENGTH),
    ),

    ...optionalProperty('source', normalizeOptionalText(hint.source, MAX_MESSAGE_LENGTH)),

    ...optionalProperty('line', hint.line),

    ...optionalProperty('column', hint.column),

    pageUrl: redactText(globalThis.location?.href ?? 'unknown'),

    userAgent: redactText(globalThis.navigator?.userAgent ?? 'unknown'),

    recentLogs: getRecentLogEntries(100),
  })
}

export function sanitizeFailureContext(
  context: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string>> {
  if (!context) {
    return {}
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(context)
        .slice(0, 32)
        .map(([key, value]) => {
          if (SENSITIVE_KEY_PATTERN.test(key)) {
            return [key, REDACTED] as const
          }

          return [key, normalizeText(safeStringify(value), 2_000)] as const
        }),
    ),
  )
}

export function formatFailureDiagnostic(incident: {
  readonly id: string
  readonly impact: string
  readonly code: string
  readonly occurredAt: string
  readonly technicalMessage: string

  readonly scope: {
    readonly kind: string
  }

  readonly context: Readonly<Record<string, unknown>>

  readonly diagnostic: FailureDiagnostic
}): string {
  const diagnostic = incident.diagnostic

  const contextEntries = Object.entries(incident.context)

  return [
    'Poietica Failure Incident',
    '',
    `Incident ID: ${incident.id}`,

    `时间: ${incident.occurredAt}`,

    `错误码: ${incident.code}`,

    `影响等级: ${incident.impact}`,

    `影响范围: ${incident.scope.kind}`,

    `错误类型: ${diagnostic.errorName}`,

    `错误信息: ${incident.technicalMessage}`,

    diagnostic.source ? `来源: ${diagnostic.source}` : undefined,

    typeof diagnostic.line === 'number' ? `行: ${String(diagnostic.line)}` : undefined,

    typeof diagnostic.column === 'number' ? `列: ${String(diagnostic.column)}` : undefined,

    `页面: ${diagnostic.pageUrl}`,

    `User Agent: ${diagnostic.userAgent}`,

    contextEntries.length > 0
      ? `\n上下文:\n${contextEntries.map(([key, value]) => `${key}: ${String(value)}`).join('\n')}`
      : undefined,

    diagnostic.stack ? `\nJavaScript Stack:\n${diagnostic.stack}` : undefined,

    diagnostic.componentStack
      ? `\nReact Component Stack:\n${diagnostic.componentStack}`
      : undefined,

    diagnostic.recentLogs.length > 0
      ? `\n最近的结构化日志:\n${formatDiagnosticLogs(diagnostic.recentLogs)}`
      : undefined,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
}

function safeStringify(value: unknown): string {
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

  const seen = new WeakSet<object>()

  try {
    return JSON.stringify(
      value,
      (_key, candidate: unknown) => {
        if (typeof candidate === 'object' && candidate !== null) {
          if (seen.has(candidate)) {
            return '[Circular]'
          }

          seen.add(candidate)
        }

        if (candidate instanceof Error) {
          return {
            name: candidate.name,
            message: candidate.message,
            stack: candidate.stack,
          }
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
}
