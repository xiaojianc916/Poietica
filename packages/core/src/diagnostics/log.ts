import { recordDiagnosticLog } from './buffer'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  readonly scope?: string
  readonly correlationId?: string
  readonly [key: string]: unknown
}

export type LogSink = (
  level: LogLevel,
  message: string,
  context: LogContext,
  timestamp: string,
) => void

let sink: LogSink = defaultConsoleSink

function defaultConsoleSink(
  level: LogLevel,
  message: string,
  context: LogContext,
  timestamp: string,
): void {
  const prefix = context.scope ? `[${context.scope}]` : ''

  const formatted = [timestamp, level.toUpperCase(), prefix, message].filter(Boolean).join(' ')

  switch (level) {
    case 'trace':
    case 'debug':
      return

    case 'info':
      return

    case 'warn':
      console.warn(formatted, context)
      return

    case 'error':
      console.error(formatted, context)
      return
  }
}

export function setLogSink(next: LogSink): void {
  sink = next
}

export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const timestamp = new Date().toISOString()

  recordDiagnosticLog(level, message, context, timestamp)

  try {
    sink(level, message, context, timestamp)
  } catch (error: unknown) {
    // Logging must not recursively become a fatal application error.
    try {
      console.error('[Poietica Observability] Log sink failed', {
        level,
        message,
        error,
      })
    } catch {
      // No further fallback is safe.
    }
  }
}

export function trace(message: string, context?: LogContext): void {
  log('trace', message, context)
}

export function debug(message: string, context?: LogContext): void {
  log('debug', message, context)
}

export function info(message: string, context?: LogContext): void {
  log('info', message, context)
}

export function warn(message: string, context?: LogContext): void {
  log('warn', message, context)
}

export function error(message: string, context?: LogContext): void {
  log('error', message, context)
}

export function initDiagnostics(options?: {
  readonly appName?: string
  readonly sink?: LogSink
}): void {
  if (options?.sink) {
    setLogSink(options.sink)
  }

  info('diagnostics initialized', {
    scope: 'diagnostics',
    appName: options?.appName ?? 'poietica',
  })
}
