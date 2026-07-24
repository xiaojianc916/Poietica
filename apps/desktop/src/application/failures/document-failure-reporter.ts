import type { EditorSessionFailure } from '@hybrid-canvas/canvas/react'
import { error as reportDiagnosticError } from '@hybrid-canvas/foundations-observability'
import { failureRuntime } from './failure-runtime'

export function reportDocumentFatal(failure: EditorSessionFailure): void {
  const technicalMessage = failure.error.message || 'Editor session render failed.'

  reportDiagnosticError('document editor session failed', {
    scope: 'document',
    operation: 'render-editor-session',
    sessionId: failure.sessionId,
    errorName: failure.error.name,
    errorMessage: technicalMessage,
    errorStack: failure.error.stack,
    componentStack: failure.componentStack,
    failureImpact: 'document-fatal',
  })

  failureRuntime.report({
    impact: 'document-fatal',
    code: 'DOCUMENT_EDITOR_SESSION_FATAL',
    userMessage: '当前画布遇到严重错误，已被隔离。其他画布仍可继续使用。',
    technicalMessage,
    scope: {
      kind: 'document',
      documentId: failure.sessionId,
    },
    recovery: 'close-document',
    cause: failure.error,
    context: {
      collector: 'editor-session-boundary',
      errorName: failure.error.name,
      ...optionalProperty('stack', failure.error.stack),
      ...optionalProperty('componentStack', failure.componentStack),
    },
  })
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
