import type { EditorSessionFailure } from '@poietica/canvas/react'
import { reportFailure } from './failure-policy'

export function reportDocumentFatal(failure: EditorSessionFailure): void {
  reportFailure('DOCUMENT_EDITOR_SESSION_FATAL', {
    cause: failure.error,

    sessionId: failure.sessionId,

    errorName: failure.error.name,

    ...optionalProperty('stack', failure.error.stack),

    ...optionalProperty('componentStack', failure.componentStack),

    collector: 'editor-session-boundary',

    operation: 'render-editor-session',
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
