import type { FailureRecovery, TerminalFailureImpact } from '@hybrid-canvas/foundations-kernel'
import {
  failureCoordinator,
  type FailureIncident,
} from '../application/failures/failure-coordinator'

export type FailureKind =
  | 'bootstrap'
  | 'render'
  | 'async'
  | 'invariant'
  | 'vite'
  | 'webview'
  | 'native-crash'

export type FailurePhase =
  | 'preflight'
  | 'runtime-construction'
  | 'react-mount'
  | 'running'
  | 'shutdown'

export interface TerminalFailureInput {
  readonly error: unknown
  readonly impact: TerminalFailureImpact

  readonly kind: FailureKind
  readonly phase: FailurePhase
  readonly code?: string
  readonly title?: string

  readonly componentStack?: string | null

  readonly source?: string
  readonly line?: number
  readonly column?: number

  readonly recovery?: Extract<FailureRecovery, 'reload' | 'restart' | 'exit' | 'none'>

  readonly context?: Readonly<Record<string, unknown>>
}

export function reportFatalIncident(input: TerminalFailureInput): FailureIncident {
  const code = input.code ?? createDefaultCode(input.kind, input.phase)

  return failureCoordinator.report({
    impact: input.impact,

    code,

    userMessage:
      input.impact === 'native-fatal'
        ? 'Hybrid Canvas 上次运行时异常终止。请复制诊断信息后继续启动。'
        : 'Hybrid Canvas 无法安全地继续当前运行。请复制诊断信息后重新加载应用。',

    cause: input.error,

    scope:
      input.impact === 'native-fatal'
        ? {
            kind: 'native-process',
          }
        : {
            kind: 'application',
          },

    recovery: input.recovery ?? (input.impact === 'native-fatal' ? 'reload' : 'reload'),

    context: {
      ...(input.context ?? {}),
      failureKind: input.kind,
      failurePhase: input.phase,
      ...optionalProperty('presentationTitle', input.title),
    },

    diagnostic: {
      kind: input.kind,
      phase: input.phase,

      ...optionalProperty('componentStack', input.componentStack ?? undefined),

      ...optionalProperty('source', input.source),

      ...optionalProperty('line', input.line),

      ...optionalProperty('column', input.column),
    },
  })
}

let reactFatalHostMounted = false

export function markReactFatalHostMounted(): void {
  reactFatalHostMounted = true
}

export function isReactFatalHostMounted(): boolean {
  return reactFatalHostMounted
}

function createDefaultCode(kind: FailureKind, phase: FailurePhase): string {
  return (
    'FATAL_' +
    kind.replaceAll('-', '_').toUpperCase() +
    '_' +
    phase.replaceAll('-', '_').toUpperCase()
  )
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
