import {
  clearDiagnosticLogs,
  error as logError,
  info as logInfo,
} from '@hybrid-canvas/foundations-observability'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFatalIncident, formatFatalDiagnostic } from './fatal-incident'

describe('fatal incident contract', () => {
  beforeEach(() => {
    clearDiagnosticLogs()
  })

  it('creates a stable fingerprint and unique incident identity', () => {
    const input = {
      error: new Error('render failed'),
      kind: 'render' as const,
      phase: 'running' as const,
      code: 'FATAL_REACT_RENDER_ERROR',
    }

    const first = createFatalIncident(input)

    const second = createFatalIncident(input)

    expect(first.id).not.toBe(second.id)

    expect(first.fingerprint).toBe(second.fingerprint)
  })

  it('normalizes string failures', () => {
    const incident = createFatalIncident({
      error: 'string failure',
      kind: 'async',
      phase: 'running',
      code: 'FATAL_STRING_FAILURE',
    })

    expect(incident.errorName).toBe('Error')

    expect(incident.technicalMessage).toBe('string failure')
  })

  it('normalizes structured non-Error failures', () => {
    const incident = createFatalIncident({
      error: {
        operation: 'load-document',
        reason: 'invalid snapshot',
      },
      kind: 'invariant',
      phase: 'running',
      code: 'FATAL_STRUCTURED_FAILURE',
    })

    expect(incident.errorName).toBe('UnknownError')

    expect(incident.technicalMessage).toContain('load-document')

    expect(incident.technicalMessage).toContain('invalid snapshot')
  })

  it('handles circular thrown values without throwing again', () => {
    const circular: {
      readonly name: string
      self?: unknown
    } = {
      name: 'circular-failure',
    }

    circular.self = circular

    expect(() => {
      createFatalIncident({
        error: circular,
        kind: 'invariant',
        phase: 'running',
        code: 'FATAL_CIRCULAR_FAILURE',
      })
    }).not.toThrow()

    const incident = createFatalIncident({
      error: circular,
      kind: 'invariant',
      phase: 'running',
      code: 'FATAL_CIRCULAR_FAILURE',
    })

    expect(incident.technicalMessage).toContain('[Circular]')
  })

  it('redacts sensitive context keys', () => {
    const incident = createFatalIncident({
      error: new Error('authentication failed'),
      kind: 'async',
      phase: 'running',
      code: 'FATAL_AUTHENTICATION_FAILURE',
      context: {
        accessToken: 'private-access-token',
        password: 'private-password',
        authorization: 'Bearer private-bearer-token',
        operation: 'connect',
      },
    })

    expect(incident.context['accessToken']).toBe('[REDACTED]')

    expect(incident.context['password']).toBe('[REDACTED]')

    expect(incident.context['authorization']).toBe('[REDACTED]')

    expect(incident.context['operation']).toBe('connect')
  })

  it('redacts bearer values and Windows user directories', () => {
    const error = new Error(
      ['Bearer abc.def.private', 'C:\\Users\\Alice\\Documents\\private.draw'].join(' '),
    )

    const incident = createFatalIncident({
      error,
      kind: 'async',
      phase: 'running',
      code: 'FATAL_REDACTION_TEST',
      source: 'C:\\Users\\Alice\\project\\main.ts',
    })

    expect(incident.technicalMessage).not.toContain('abc.def.private')

    expect(incident.technicalMessage).not.toContain('C:\\Users\\Alice')

    expect(incident.source).not.toContain('C:\\Users\\Alice')

    expect(incident.technicalMessage).toContain('[REDACTED]')
  })

  it('omits absent optional properties instead of assigning undefined', () => {
    const incident = createFatalIncident({
      error: 'failure without stack',
      kind: 'async',
      phase: 'running',
      code: 'FATAL_OPTIONAL_PROPERTY_TEST',
    })

    expect(Object.hasOwn(incident, 'stack')).toBe(false)

    expect(Object.hasOwn(incident, 'componentStack')).toBe(false)

    expect(Object.hasOwn(incident, 'source')).toBe(false)

    expect(Object.hasOwn(incident, 'line')).toBe(false)

    expect(Object.hasOwn(incident, 'column')).toBe(false)
  })

  it('bounds oversized error messages', () => {
    const incident = createFatalIncident({
      error: 'x'.repeat(10_000),
      kind: 'async',
      phase: 'running',
      code: 'FATAL_OVERSIZED_MESSAGE',
    })

    expect(incident.technicalMessage.length).toBeLessThan(10_000)

    expect(incident.technicalMessage).toContain('Diagnostic value truncated')
  })

  it('freezes recent logs when the incident is created', () => {
    logInfo('before fatal', {
      scope: 'fatal-test',
      operation: 'before',
    })

    const incident = createFatalIncident({
      error: new Error('fatal'),
      kind: 'invariant',
      phase: 'running',
      code: 'FATAL_LOG_SNAPSHOT_TEST',
    })

    const capturedLength = incident.recentLogs.length

    logError('after fatal', {
      scope: 'fatal-test',
      operation: 'after',
    })

    expect(incident.recentLogs).toHaveLength(capturedLength)

    expect(incident.recentLogs.some((entry) => entry.message === 'before fatal')).toBe(true)

    expect(incident.recentLogs.some((entry) => entry.message === 'after fatal')).toBe(false)
  })

  it('includes recent structured logs in copied diagnostics', () => {
    logInfo('document opened', {
      scope: 'document',
      operation: 'open',
      documentId: 'document-1',
    })

    const incident = createFatalIncident({
      error: new Error('render failed'),
      kind: 'render',
      phase: 'running',
      code: 'FATAL_DIAGNOSTIC_LOG_TEST',
    })

    const diagnostic = formatFatalDiagnostic(incident)

    expect(diagnostic).toContain('最近的结构化日志')

    expect(diagnostic).toContain('document opened')

    expect(diagnostic).toContain('operation: open')
  })

  it('includes React component stack when supplied', () => {
    const incident = createFatalIncident({
      error: new Error('component failed'),
      kind: 'render',
      phase: 'running',
      code: 'FATAL_COMPONENT_STACK_TEST',
      componentStack: '\n    at CanvasEditor\n    at AppShell',
    })

    const diagnostic = formatFatalDiagnostic(incident)

    expect(diagnostic).toContain('React Component Stack')

    expect(diagnostic).toContain('CanvasEditor')
  })
})
