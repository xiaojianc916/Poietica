import {
  type DiagnosticLogEntry,
  formatDiagnosticLogs,
  getRecentLogEntries,
} from '@hybrid-canvas/foundations-observability'

export type FatalIncidentKind =
  | 'bootstrap'
  | 'render'
  | 'async'
  | 'invariant'
  | 'vite'
  | 'webview'
  | 'native-crash'

export type FatalIncidentPhase =
  | 'preflight'
  | 'runtime-construction'
  | 'react-mount'
  | 'running'
  | 'shutdown'

export type FatalRecovery = 'reload' | 'restart' | 'none'

export interface FatalIncident {
  readonly id: string
  readonly fingerprint: string
  readonly severity: 'fatal'
  readonly kind: FatalIncidentKind
  readonly phase: FatalIncidentPhase
  readonly code: string
  readonly title: string
  readonly message: string
  readonly technicalMessage: string
  readonly errorName: string
  readonly stack?: string
  readonly componentStack?: string
  readonly source?: string
  readonly line?: number
  readonly column?: number
  readonly occurredAt: string
  readonly pageUrl: string
  readonly userAgent: string
  readonly recovery: FatalRecovery
  readonly context: Readonly<Record<string, string>>
  readonly recentLogs: readonly DiagnosticLogEntry[]
}

export interface CreateFatalIncidentInput {
  readonly error: unknown
  readonly kind: FatalIncidentKind
  readonly phase: FatalIncidentPhase
  readonly code?: string
  readonly title?: string
  readonly componentStack?: string | null
  readonly source?: string
  readonly line?: number
  readonly column?: number
  readonly recovery?: FatalRecovery
  readonly context?: Readonly<Record<string, unknown>>
}

interface NormalizedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

const REDACTED = '[REDACTED]'
const MAX_MESSAGE_LENGTH = 4_000
const MAX_STACK_LENGTH = 32_000
const MAX_CONTEXT_VALUE_LENGTH = 2_000
const MAX_CONTEXT_ENTRIES = 32

const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|license|api[-_]?key/i

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

const WINDOWS_USER_PATH_PATTERN = /[A-Za-z]:\\Users\\[^\\\s]+/gi

const UNIX_USER_PATH_PATTERN = /\/(?:Users|home)\/[^/\s]+/gi

export function createFatalIncident(input: CreateFatalIncidentInput): FatalIncident {
  const normalized = normalizeUnknownError(input.error)
  const occurredAt = new Date().toISOString()
  const recentLogs = getRecentLogEntries(100)
  const code = input.code ?? createDefaultCode(input.kind, input.phase)

  const technicalMessage = normalized.message || 'Unknown fatal error'

  const fingerprint = [
    input.kind,
    input.phase,
    code,
    normalized.name,
    technicalMessage,
    input.source ?? '',
  ].join('|')

  return {
    id: createIncidentId(),
    fingerprint,
    severity: 'fatal',
    kind: input.kind,
    phase: input.phase,
    code,
    title: input.title ?? '应用遇到严重错误',
    message: 'Hybrid Canvas 无法安全地继续当前运行。请复制诊断信息后重新加载应用。',
    technicalMessage,
    errorName: normalized.name,
    ...optionalProperty('stack', normalized.stack),
    ...optionalProperty(
      'componentStack',
      normalizeOptionalText(input.componentStack ?? undefined, MAX_STACK_LENGTH),
    ),
    ...optionalProperty('source', normalizeOptionalText(input.source, MAX_MESSAGE_LENGTH)),
    ...optionalProperty('line', input.line),
    ...optionalProperty('column', input.column),
    occurredAt,
    pageUrl: redactText(globalThis.location?.href ?? 'unknown'),
    userAgent: redactText(globalThis.navigator?.userAgent ?? 'unknown'),
    recovery: input.recovery ?? 'reload',
    context: sanitizeContext(input.context),
    recentLogs,
  }
}

export function formatFatalDiagnostic(incident: FatalIncident): string {
  const contextEntries = Object.entries(incident.context)

  return [
    'Hybrid Canvas Fatal Incident',
    '',
    `Incident ID: ${incident.id}`,
    `时间: ${incident.occurredAt}`,
    `错误码: ${incident.code}`,
    `错误类型: ${incident.errorName}`,
    `错误种类: ${incident.kind}`,
    `运行阶段: ${incident.phase}`,
    `错误信息: ${incident.technicalMessage}`,
    incident.source ? `来源: ${incident.source}` : undefined,
    typeof incident.line === 'number' ? `行: ${String(incident.line)}` : undefined,
    typeof incident.column === 'number' ? `列: ${String(incident.column)}` : undefined,
    `页面: ${incident.pageUrl}`,
    `User Agent: ${incident.userAgent}`,
    contextEntries.length > 0
      ? `\n上下文:\n${contextEntries.map(([key, value]) => `${key}: ${value}`).join('\n')}`
      : undefined,
    incident.stack ? `\nJavaScript Stack:\n${incident.stack}` : undefined,
    incident.componentStack ? `\nReact Component Stack:\n${incident.componentStack}` : undefined,
    incident.recentLogs.length > 0
      ? `\n最近的结构化日志:\n${formatDiagnosticLogs(incident.recentLogs)}`
      : undefined,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
}

export function normalizeUnknownError(value: unknown): NormalizedError {
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: normalizeText(value.message || 'Unknown error', MAX_MESSAGE_LENGTH),
      ...optionalProperty('stack', normalizeOptionalText(value.stack, MAX_STACK_LENGTH)),
    }
  }

  if (typeof value === 'string') {
    return {
      name: 'Error',
      message: normalizeText(value || 'Unknown error', MAX_MESSAGE_LENGTH),
    }
  }

  return {
    name: 'UnknownError',
    message: normalizeText(safeStringify(value), MAX_MESSAGE_LENGTH),
  }
}

function sanitizeContext(
  context: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string>> {
  if (!context) {
    return {}
  }

  const entries = Object.entries(context)
    .slice(0, MAX_CONTEXT_ENTRIES)
    .map(([key, value]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, REDACTED] as const
      }

      return [key, normalizeText(safeStringify(value), MAX_CONTEXT_VALUE_LENGTH)] as const
    })

  return Object.fromEntries(entries)
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

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  if (value === undefined) {
    return {}
  }

  return {
    [key]: value,
  } as Record<Key, Value>
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

function createDefaultCode(kind: FatalIncidentKind, phase: FatalIncidentPhase): string {
  return (
    'FATAL_' +
    kind.replaceAll('-', '_').toUpperCase() +
    '_' +
    phase.replaceAll('-', '_').toUpperCase()
  )
}

function createIncidentId(): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)

  return `fatal-${Date.now().toString(36)}-${randomPart}`
}
