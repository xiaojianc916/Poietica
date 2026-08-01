export const FAILURE_IMPACTS = [
  'recoverable',
  'feature-degraded',
  'application-fatal',
  'native-fatal',
] as const

export type FailureImpact = (typeof FAILURE_IMPACTS)[number]

export type NonTerminalFailureImpact = Extract<FailureImpact, 'recoverable' | 'feature-degraded'>

export type TerminalFailureImpact = Extract<FailureImpact, 'application-fatal' | 'native-fatal'>

export type FailureRecovery =
  | 'retry'
  | 'dismiss'
  | 'disable-feature'
  | 'reload'
  | 'restart'
  | 'exit'
  | 'none'

export type FailureScope =
  | {
      readonly kind: 'operation'
      readonly operation: string
    }
  | {
      readonly kind: 'feature'
      readonly featureId: string
    }
  | {
      readonly kind: 'application'
    }
  | {
      readonly kind: 'native-process'
    }

export interface ClassifiedFailureInput {
  readonly impact: FailureImpact
  readonly code: string
  readonly userMessage: string
  readonly technicalMessage: string
  readonly scope: FailureScope
  readonly recovery: FailureRecovery
  readonly cause?: unknown
  readonly context?: Readonly<Record<string, unknown>>
}

export interface ClassifiedFailure {
  readonly id: string
  readonly fingerprint: string
  readonly impact: FailureImpact
  readonly code: string
  readonly userMessage: string
  readonly technicalMessage: string
  readonly scope: FailureScope
  readonly recovery: FailureRecovery
  readonly occurredAt: string
  readonly cause?: unknown
  readonly context: Readonly<Record<string, unknown>>
}

const RECOVERY_BY_IMPACT = {
  recoverable: new Set<FailureRecovery>(['retry', 'dismiss', 'none']),

  'feature-degraded': new Set<FailureRecovery>(['retry', 'dismiss', 'disable-feature', 'none']),

  'application-fatal': new Set<FailureRecovery>(['reload', 'restart', 'exit', 'none']),

  'native-fatal': new Set<FailureRecovery>(['reload', 'restart', 'exit', 'none']),
} satisfies Record<FailureImpact, ReadonlySet<FailureRecovery>>

let failureSequence = 0

export function createClassifiedFailure(input: ClassifiedFailureInput): ClassifiedFailure {
  validateFailurePolicy(input)

  const occurredAt = new Date().toISOString()

  const scopeKey = createFailureScopeKey(input.scope)

  const fingerprint = [input.impact, input.code, scopeKey, input.technicalMessage].join('|')

  return Object.freeze({
    id: createFailureId(),
    fingerprint,
    impact: input.impact,
    code: input.code,
    userMessage: input.userMessage,
    technicalMessage: input.technicalMessage,
    scope: Object.freeze(input.scope),
    recovery: input.recovery,
    occurredAt,
    ...optionalProperty('cause', input.cause),
    context: Object.freeze({
      ...(input.context ?? {}),
    }),
  })
}

export function isTerminalFailureImpact(impact: FailureImpact): impact is TerminalFailureImpact {
  return impact === 'application-fatal' || impact === 'native-fatal'
}

export function isNonTerminalFailureImpact(
  impact: FailureImpact,
): impact is NonTerminalFailureImpact {
  return !isTerminalFailureImpact(impact)
}

export function createFailureScopeKey(scope: FailureScope): string {
  switch (scope.kind) {
    case 'operation':
      return `operation:${scope.operation}`

    case 'feature':
      return `feature:${scope.featureId}`

    case 'application':
      return 'application'

    case 'native-process':
      return 'native-process'
  }
}

export function validateFailurePolicy(input: ClassifiedFailureInput): void {
  if (input.code.trim().length === 0) {
    throw new Error('Failure code must not be empty.')
  }

  if (input.userMessage.trim().length === 0) {
    throw new Error('Failure userMessage must not be empty.')
  }

  if (input.technicalMessage.trim().length === 0) {
    throw new Error('Failure technicalMessage must not be empty.')
  }

  const allowedRecovery = RECOVERY_BY_IMPACT[input.impact]

  if (!allowedRecovery.has(input.recovery)) {
    throw new Error(
      ['Recovery', input.recovery, 'is invalid for impact', `${input.impact}.`].join(' '),
    )
  }

  switch (input.impact) {
    case 'recoverable': {
      if (input.scope.kind === 'application' || input.scope.kind === 'native-process') {
        throw new Error('Recoverable failure cannot own an application or native-process scope.')
      }

      return
    }

    case 'feature-degraded': {
      if (input.scope.kind !== 'feature') {
        throw new Error('Feature-degraded failure requires a feature scope.')
      }

      return
    }

    case 'application-fatal': {
      if (input.scope.kind !== 'application') {
        throw new Error('Application-fatal failure requires an application scope.')
      }

      return
    }

    case 'native-fatal': {
      if (input.scope.kind !== 'native-process') {
        throw new Error('Native-fatal failure requires a native-process scope.')
      }
    }
  }
}

function createFailureId(): string {
  failureSequence += 1

  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)

  return ['failure', Date.now().toString(36), failureSequence.toString(36), randomPart].join('-')
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
