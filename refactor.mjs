import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  failurePolicy: 'foundations/kernel/src/failure-policy.ts',

  coordinator: 'apps/desktop/src/application/failures/failure-coordinator.ts',

  coordinatorTest: 'apps/desktop/src/application/failures/failure-coordinator.test.ts',

  diagnostic: 'apps/desktop/src/application/failures/failure-diagnostic.ts',

  fatalRuntime: 'apps/desktop/src/fatal/fatal-runtime.ts',

  fatalHost: 'apps/desktop/src/fatal/FatalErrorHost.tsx',

  fatalScreen: 'apps/desktop/src/fatal/FatalErrorScreen.tsx',

  preReact: 'apps/desktop/src/fatal/pre-react-entry.ts',

  collectors: 'apps/desktop/src/fatal/fatal-collectors.ts',

  architectureCheck: 'tests/architecture/check-failure-architecture-convergence.mjs',

  adr: 'docs/adr/ADR-011-unified-failure-coordinator.md',
})

const LEGACY_FILES = [
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/application/failures/failure-runtime.test.ts',

  'apps/desktop/src/fatal/fatal-controller.ts',
  'apps/desktop/src/fatal/fatal-controller.test.ts',

  'apps/desktop/src/fatal/fatal-incident.ts',
  'apps/desktop/src/fatal/fatal-incident.test.ts',
]

const LEGACY_ARCHITECTURE_CHECKS = [
  'check-fatal-error-architecture.mjs',
  'check-fatal-state-machine.mjs',
  'check-fatal-contract-tests.mjs',
  'check-fatal-escalation-policy.mjs',
  'check-failure-severity-architecture.mjs',
  'check-diagnostic-observability.mjs',
]

async function main() {
  await assertRepository()
  await allowHistoricalNativeReload()

  await writeFailureDiagnostic()
  await writeFailureCoordinator()
  await writeCoordinatorTests()

  await rewriteFatalRuntime()
  await rewriteFatalHost()
  await rewriteFatalScreen()
  await rewritePreReactRenderer()

  await migrateFailureRuntimeConsumers()
  await migrateFatalCollectors()

  await removeLegacyFiles()
  await writeArchitectureCheck()
  await writeArchitectureDecision()
  await consolidateArchitectureCommands()

  console.log('')
  console.log('Unified failure architecture convergence completed.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function allowHistoricalNativeReload() {
  const file = resolvePath(FILES.failurePolicy)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    "'native-fatal': new Set<FailureRecovery>(['restart', 'exit', 'none'])",
    "'native-fatal': new Set<FailureRecovery>(['reload', 'restart', 'exit', 'none'])",
  )

  await writeFile(file, normalizeText(source), 'utf8')
}

async function writeFailureDiagnostic() {
  const source = `import {
  formatDiagnosticLogs,
  getRecentLogEntries,
  type DiagnosticLogEntry,
} from '@hybrid-canvas/foundations-observability'

export interface FailureDiagnosticHint {
  readonly kind?: string
  readonly phase?: string
  readonly componentStack?:
    string | null

  readonly source?: string
  readonly line?: number
  readonly column?: number
}

export interface FailureDiagnostic {
  readonly errorName: string
  readonly stack?: string
  readonly componentStack?:
    string

  readonly source?: string
  readonly line?: number
  readonly column?: number

  readonly pageUrl: string
  readonly userAgent: string

  readonly recentLogs:
    readonly DiagnosticLogEntry[]
}

interface NormalizedCause {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

const REDACTED = '[REDACTED]'
const MAX_MESSAGE_LENGTH = 4_000
const MAX_STACK_LENGTH = 32_000

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|authorization|cookie|license|api[-_]?key/i

const BEARER_PATTERN =
  /\\bBearer\\s+[A-Za-z0-9._~+/=-]+/gi

const WINDOWS_USER_PATH_PATTERN =
  /[A-Za-z]:\\\\Users\\\\[^\\\\\\s]+/gi

const UNIX_USER_PATH_PATTERN =
  /\\/(?:Users|home)\\/[^/\\s]+/gi

export function normalizeFailureCause(
  cause: unknown,
): NormalizedCause {
  if (cause instanceof Error) {
    return {
      name:
        cause.name || 'Error',

      message: normalizeText(
        cause.message ||
          'Unknown error',
        MAX_MESSAGE_LENGTH,
      ),

      ...optionalProperty(
        'stack',
        normalizeOptionalText(
          cause.stack,
          MAX_STACK_LENGTH,
        ),
      ),
    }
  }

  if (typeof cause === 'string') {
    return {
      name: 'Error',
      message: normalizeText(
        cause || 'Unknown error',
        MAX_MESSAGE_LENGTH,
      ),
    }
  }

  return {
    name: 'UnknownError',
    message: normalizeText(
      safeStringify(cause),
      MAX_MESSAGE_LENGTH,
    ),
  }
}

export function createFailureDiagnostic(
  cause: unknown,
  hint:
    FailureDiagnosticHint = {},
): FailureDiagnostic {
  const normalized =
    normalizeFailureCause(cause)

  return Object.freeze({
    errorName: normalized.name,

    ...optionalProperty(
      'stack',
      normalized.stack,
    ),

    ...optionalProperty(
      'componentStack',
      normalizeOptionalText(
        hint.componentStack ??
          undefined,
        MAX_STACK_LENGTH,
      ),
    ),

    ...optionalProperty(
      'source',
      normalizeOptionalText(
        hint.source,
        MAX_MESSAGE_LENGTH,
      ),
    ),

    ...optionalProperty(
      'line',
      hint.line,
    ),

    ...optionalProperty(
      'column',
      hint.column,
    ),

    pageUrl: redactText(
      globalThis.location?.href ??
        'unknown',
    ),

    userAgent: redactText(
      globalThis.navigator?.userAgent ??
        'unknown',
    ),

    recentLogs:
      getRecentLogEntries(100),
  })
}

export function sanitizeFailureContext(
  context:
    | Readonly<
        Record<string, unknown>
      >
    | undefined,
): Readonly<Record<string, string>> {
  if (!context) {
    return {}
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(context)
        .slice(0, 32)
        .map(([key, value]) => {
          if (
            SENSITIVE_KEY_PATTERN.test(
              key,
            )
          ) {
            return [
              key,
              REDACTED,
            ] as const
          }

          return [
            key,
            normalizeText(
              safeStringify(value),
              2_000,
            ),
          ] as const
        }),
    ),
  )
}

export function formatFailureDiagnostic(
  incident: {
    readonly id: string
    readonly impact: string
    readonly code: string
    readonly occurredAt: string
    readonly technicalMessage:
      string

    readonly scope: {
      readonly kind: string
    }

    readonly context: Readonly<
      Record<string, unknown>
    >

    readonly diagnostic:
      FailureDiagnostic
  },
): string {
  const diagnostic =
    incident.diagnostic

  const contextEntries =
    Object.entries(
      incident.context,
    )

  return [
    'Hybrid Canvas Failure Incident',
    '',
    'Incident ID: ' +
      incident.id,

    '时间: ' +
      incident.occurredAt,

    '错误码: ' +
      incident.code,

    '影响等级: ' +
      incident.impact,

    '影响范围: ' +
      incident.scope.kind,

    '错误类型: ' +
      diagnostic.errorName,

    '错误信息: ' +
      incident.technicalMessage,

    diagnostic.source
      ? '来源: ' +
        diagnostic.source
      : undefined,

    typeof diagnostic.line ===
      'number'
      ? '行: ' +
        String(diagnostic.line)
      : undefined,

    typeof diagnostic.column ===
      'number'
      ? '列: ' +
        String(diagnostic.column)
      : undefined,

    '页面: ' +
      diagnostic.pageUrl,

    'User Agent: ' +
      diagnostic.userAgent,

    contextEntries.length > 0
      ? '\\n上下文:\\n' +
        contextEntries
          .map(
            ([key, value]) =>
              key +
              ': ' +
              String(value),
          )
          .join('\\n')
      : undefined,

    diagnostic.stack
      ? '\\nJavaScript Stack:\\n' +
        diagnostic.stack
      : undefined,

    diagnostic.componentStack
      ? '\\nReact Component Stack:\\n' +
        diagnostic.componentStack
      : undefined,

    diagnostic.recentLogs.length >
    0
      ? '\\n最近的结构化日志:\\n' +
        formatDiagnosticLogs(
          diagnostic.recentLogs,
        )
      : undefined,
  ]
    .filter(
      (
        value,
      ): value is string =>
        typeof value === 'string' &&
        value.length > 0,
    )
    .join('\\n')
}

function safeStringify(
  value: unknown,
): string {
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

  const seen =
    new WeakSet<object>()

  try {
    return JSON.stringify(
      value,
      (
        _key,
        candidate: unknown,
      ) => {
        if (
          typeof candidate ===
            'object' &&
          candidate !== null
        ) {
          if (
            seen.has(candidate)
          ) {
            return '[Circular]'
          }

          seen.add(candidate)
        }

        if (
          candidate instanceof Error
        ) {
          return {
            name: candidate.name,
            message:
              candidate.message,
            stack:
              candidate.stack,
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

  return normalizeText(
    value,
    maximumLength,
  )
}

function normalizeText(
  value: string,
  maximumLength: number,
): string {
  const redacted =
    redactText(value)

  if (
    redacted.length <=
    maximumLength
  ) {
    return redacted
  }

  return (
    redacted.slice(
      0,
      maximumLength,
    ) +
    '\\n[Diagnostic value truncated]'
  )
}

function redactText(
  value: string,
): string {
  return value
    .replace(
      BEARER_PATTERN,
      'Bearer ' + REDACTED,
    )
    .replace(
      WINDOWS_USER_PATH_PATTERN,
      'C:\\\\Users\\\\' +
        REDACTED,
    )
    .replace(
      UNIX_USER_PATH_PATTERN,
      '/Users/' + REDACTED,
    )
}

function optionalProperty<
  Key extends string,
  Value,
>(
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
`

  await writeText(FILES.diagnostic, source)
}

async function writeFailureCoordinator() {
  const source = `import {
  createClassifiedFailure,
  createFailureScopeKey,
  isTerminalFailureImpact,
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  type FailureImpact,
  type FailureScope,
  type NonTerminalFailureImpact,
  type TerminalFailureImpact,
} from '@hybrid-canvas/foundations-kernel'
import {
  createFailureDiagnostic,
  normalizeFailureCause,
  sanitizeFailureContext,
  type FailureDiagnostic,
  type FailureDiagnosticHint,
} from './failure-diagnostic'

export interface FailureIncident
  extends ClassifiedFailure {
  readonly diagnostic:
    FailureDiagnostic
}

export type TerminalFailureIncident =
  FailureIncident & {
    readonly impact:
      TerminalFailureImpact
  }

export type NonTerminalFailureIncident =
  FailureIncident & {
    readonly impact:
      NonTerminalFailureImpact
  }

export interface PresentedFailure {
  readonly incident:
    NonTerminalFailureIncident

  readonly occurrences: number
}

export interface TerminalFailureState {
  readonly incident:
    TerminalFailureIncident

  readonly additionalIncidentCount:
    number
}

export interface FailureSnapshot {
  readonly terminal:
    TerminalFailureState | null

  readonly failures:
    readonly PresentedFailure[]

  readonly degradedFeatures:
    readonly string[]

  readonly quarantinedDocuments:
    readonly string[]
}

export interface FailureSignal
  extends Omit<
    ClassifiedFailureInput,
    'technicalMessage'
  > {
  readonly technicalMessage?:
    string

  readonly diagnostic?:
    FailureDiagnosticHint
}

export type NonTerminalFailureInput =
  FailureSignal & {
    readonly impact:
      NonTerminalFailureImpact
  }

export type TerminalFailureInput =
  FailureSignal & {
    readonly impact:
      TerminalFailureImpact
  }

export type FailureListener =
  () => void

const EMPTY_SNAPSHOT:
  FailureSnapshot =
  Object.freeze({
    terminal: null,
    failures: Object.freeze([]),

    degradedFeatures:
      Object.freeze([]),

    quarantinedDocuments:
      Object.freeze([]),
  })

const MAX_PRESENTED_FAILURES = 20

export class FailureCoordinator {
  private snapshot:
    FailureSnapshot =
    EMPTY_SNAPSHOT

  private readonly listeners =
    new Set<FailureListener>()

  private readonly degradedFeatures =
    new Set<string>()

  private readonly quarantinedDocuments =
    new Set<string>()

  private readonly terminalFingerprints =
    new Set<string>()

  readonly getSnapshot =
    (): FailureSnapshot => {
      return this.snapshot
    }

  readonly subscribe = (
    listener: FailureListener,
  ): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  report(
    signal: FailureSignal,
  ): FailureIncident {
    const incident =
      this.createIncident(signal)

    if (
      isTerminalFailureImpact(
        incident.impact,
      )
    ) {
      return this.reportTerminal(
        incident as
          TerminalFailureIncident,
      )
    }

    return this.reportNonTerminal(
      incident as
        NonTerminalFailureIncident,
    )
  }

  dismiss(
    incidentId: string,
  ): void {
    const failures =
      this.snapshot.failures.filter(
        (entry) =>
          entry.incident.id !==
          incidentId,
      )

    if (
      failures.length ===
      this.snapshot.failures.length
    ) {
      return
    }

    this.publish({
      ...this.snapshot,
      failures,
    })
  }

  resolveScope(
    scope: FailureScope,
  ): void {
    const scopeKey =
      createFailureScopeKey(scope)

    if (scope.kind === 'feature') {
      this.degradedFeatures.delete(
        scope.featureId,
      )
    }

    if (scope.kind === 'document') {
      this.quarantinedDocuments.delete(
        scope.documentId,
      )
    }

    this.publish({
      ...this.snapshot,

      failures:
        this.snapshot.failures.filter(
          (entry) =>
            createFailureScopeKey(
              entry.incident.scope,
            ) !== scopeKey,
        ),

      degradedFeatures: [
        ...this.degradedFeatures,
      ],

      quarantinedDocuments: [
        ...this.quarantinedDocuments,
      ],
    })
  }

  private createIncident(
    signal: FailureSignal,
  ): FailureIncident {
    const normalized =
      normalizeFailureCause(
        signal.cause,
      )

    const technicalMessage =
      signal.technicalMessage ??
      normalized.message

    const context =
      sanitizeFailureContext(
        signal.context,
      )

    const classified =
      createClassifiedFailure({
        impact: signal.impact,
        code: signal.code,
        userMessage:
          signal.userMessage,

        technicalMessage,
        scope: signal.scope,
        recovery: signal.recovery,

        ...optionalProperty(
          'cause',
          signal.cause,
        ),

        context,
      })

    return Object.freeze({
      ...classified,

      diagnostic:
        createFailureDiagnostic(
          signal.cause,
          signal.diagnostic,
        ),
    })
  }

  private reportTerminal(
    incident:
      TerminalFailureIncident,
  ): TerminalFailureIncident {
    const current =
      this.snapshot.terminal

    if (
      this.terminalFingerprints.has(
        incident.fingerprint,
      )
    ) {
      return (
        current?.incident ??
        incident
      )
    }

    this.terminalFingerprints.add(
      incident.fingerprint,
    )

    if (current) {
      this.publish({
        ...this.snapshot,

        terminal:
          Object.freeze({
            incident:
              current.incident,

            additionalIncidentCount:
              current
                .additionalIncidentCount +
              1,
          }),
      })

      return current.incident
    }

    this.publish({
      ...this.snapshot,

      terminal:
        Object.freeze({
          incident,
          additionalIncidentCount: 0,
        }),
    })

    return incident
  }

  private reportNonTerminal(
    incident:
      NonTerminalFailureIncident,
  ): NonTerminalFailureIncident {
    if (
      incident.impact ===
        'feature-degraded' &&
      incident.scope.kind ===
        'feature'
    ) {
      this.degradedFeatures.add(
        incident.scope.featureId,
      )
    }

    if (
      incident.impact ===
        'document-fatal' &&
      incident.scope.kind ===
        'document'
    ) {
      this.quarantinedDocuments.add(
        incident.scope.documentId,
      )
    }

    const existing =
      this.snapshot.failures.find(
        (entry) =>
          entry.incident
            .fingerprint ===
          incident.fingerprint,
      )

    const retained =
      this.snapshot.failures.filter(
        (entry) =>
          entry.incident
            .fingerprint !==
          incident.fingerprint,
      )

    const presented:
      PresentedFailure =
      Object.freeze({
        incident,
        occurrences:
          (existing?.occurrences ??
            0) + 1,
      })

    this.publish({
      ...this.snapshot,

      failures: [
        ...retained,
        presented,
      ].slice(
        -MAX_PRESENTED_FAILURES,
      ),

      degradedFeatures: [
        ...this.degradedFeatures,
      ],

      quarantinedDocuments: [
        ...this.quarantinedDocuments,
      ],
    })

    return incident
  }

  private publish(
    snapshot: FailureSnapshot,
  ): void {
    this.snapshot =
      Object.freeze({
        terminal:
          snapshot.terminal,

        failures:
          Object.freeze([
            ...snapshot.failures,
          ]),

        degradedFeatures:
          Object.freeze([
            ...snapshot
              .degradedFeatures,
          ]),

        quarantinedDocuments:
          Object.freeze([
            ...snapshot
              .quarantinedDocuments,
          ]),
      })

    for (
      const listener of [
        ...this.listeners,
      ]
    ) {
      try {
        listener()
      } catch (error: unknown) {
        try {
          console.error(
            '[Hybrid Canvas] Failure coordinator listener failed',
            error,
          )
        } catch {
          // No further safe fallback.
        }
      }
    }
  }
}

export const failureCoordinator =
  new FailureCoordinator()

function optionalProperty<
  Key extends string,
  Value,
>(
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
`

  await writeText(FILES.coordinator, source)
}

async function writeCoordinatorTests() {
  const source = `import {
  describe,
  expect,
  it,
} from 'vitest'
import { FailureCoordinator } from './failure-coordinator'

describe('FailureCoordinator', () => {
  it('owns recoverable failures', () => {
    const coordinator =
      new FailureCoordinator()

    coordinator.report({
      impact: 'recoverable',
      code: 'SAVE_FAILED',
      userMessage:
        '保存失败。',
      cause:
        new Error('disk failure'),
      scope: {
        kind: 'operation',
        operation: 'save',
      },
      recovery: 'retry',
    })

    expect(
      coordinator.getSnapshot()
        .failures,
    ).toHaveLength(1)

    expect(
      coordinator.getSnapshot()
        .terminal,
    ).toBeNull()
  })

  it('owns feature degradation', () => {
    const coordinator =
      new FailureCoordinator()

    coordinator.report({
      impact:
        'feature-degraded',
      code:
        'SETTINGS_UNAVAILABLE',
      userMessage:
        '设置暂时不可用。',
      cause:
        new Error('settings'),
      scope: {
        kind: 'feature',
        featureId: 'settings',
      },
      recovery:
        'disable-feature',
    })

    expect(
      coordinator.getSnapshot()
        .degradedFeatures,
    ).toContain('settings')
  })

  it('owns document quarantine', () => {
    const coordinator =
      new FailureCoordinator()

    coordinator.report({
      impact: 'document-fatal',
      code:
        'DOCUMENT_UNSAFE',
      userMessage:
        '画布已停止运行。',
      cause:
        new Error('render'),
      scope: {
        kind: 'document',
        documentId: 'document-1',
      },
      recovery:
        'close-document',
    })

    expect(
      coordinator.getSnapshot()
        .quarantinedDocuments,
    ).toContain('document-1')
  })

  it('locks the first terminal failure', () => {
    const coordinator =
      new FailureCoordinator()

    const first =
      coordinator.report({
        impact:
          'application-fatal',
        code: 'FIRST_FATAL',
        userMessage:
          '应用无法继续。',
        cause:
          new Error('first'),
        scope: {
          kind: 'application',
        },
        recovery: 'reload',
      })

    coordinator.report({
      impact:
        'application-fatal',
      code: 'SECOND_FATAL',
      userMessage:
        '应用无法继续。',
      cause:
        new Error('second'),
      scope: {
        kind: 'application',
      },
      recovery: 'reload',
    })

    const terminal =
      coordinator.getSnapshot()
        .terminal

    expect(
      terminal?.incident.id,
    ).toBe(first.id)

    expect(
      terminal
        ?.additionalIncidentCount,
    ).toBe(1)
  })

  it('deduplicates terminal fingerprints', () => {
    const coordinator =
      new FailureCoordinator()

    const signal = {
      impact:
        'application-fatal' as const,

      code: 'REPEATED_FATAL',

      userMessage:
        '应用无法继续。',

      cause:
        new Error('same'),

      scope: {
        kind:
          'application' as const,
      },

      recovery: 'reload' as const,
    }

    coordinator.report(signal)
    coordinator.report(signal)

    expect(
      coordinator.getSnapshot()
        .terminal
        ?.additionalIncidentCount,
    ).toBe(0)
  })
})
`

  await writeText(FILES.coordinatorTest, source)
}

async function rewriteFatalRuntime() {
  const source = `import type {
  FailureRecovery,
  TerminalFailureImpact,
} from '@hybrid-canvas/foundations-kernel'
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
  readonly impact:
    TerminalFailureImpact

  readonly kind: FailureKind
  readonly phase: FailurePhase
  readonly code?: string
  readonly title?: string

  readonly componentStack?:
    string | null

  readonly source?: string
  readonly line?: number
  readonly column?: number

  readonly recovery?:
    Extract<
      FailureRecovery,
      | 'reload'
      | 'restart'
      | 'exit'
      | 'none'
    >

  readonly context?: Readonly<
    Record<string, unknown>
  >
}

export function reportFatalIncident(
  input: TerminalFailureInput,
): FailureIncident {
  const code =
    input.code ??
    createDefaultCode(
      input.kind,
      input.phase,
    )

  return failureCoordinator.report({
    impact: input.impact,

    code,

    userMessage:
      input.impact ===
      'native-fatal'
        ? 'Hybrid Canvas 上次运行时异常终止。请复制诊断信息后继续启动。'
        : 'Hybrid Canvas 无法安全地继续当前运行。请复制诊断信息后重新加载应用。',

    cause: input.error,

    scope:
      input.impact ===
      'native-fatal'
        ? {
            kind:
              'native-process',
          }
        : {
            kind:
              'application',
          },

    recovery:
      input.recovery ??
      (input.impact ===
      'native-fatal'
        ? 'reload'
        : 'reload'),

    context: {
      ...(input.context ?? {}),
      failureKind: input.kind,
      failurePhase: input.phase,
      ...optionalProperty(
        'presentationTitle',
        input.title,
      ),
    },

    diagnostic: {
      kind: input.kind,
      phase: input.phase,

      ...optionalProperty(
        'componentStack',
        input.componentStack ??
          undefined,
      ),

      ...optionalProperty(
        'source',
        input.source,
      ),

      ...optionalProperty(
        'line',
        input.line,
      ),

      ...optionalProperty(
        'column',
        input.column,
      ),
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

function createDefaultCode(
  kind: FailureKind,
  phase: FailurePhase,
): string {
  return (
    'FATAL_' +
    kind
      .replaceAll('-', '_')
      .toUpperCase() +
    '_' +
    phase
      .replaceAll('-', '_')
      .toUpperCase()
  )
}

function optionalProperty<
  Key extends string,
  Value,
>(
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
`

  await writeText(FILES.fatalRuntime, source)
}

async function rewriteFatalHost() {
  const source = `import {
  type ReactNode,
  useSyncExternalStore,
} from 'react'
import { failureCoordinator } from '../application/failures/failure-coordinator'
import { FatalErrorBoundary } from './FatalErrorBoundary'
import { FatalErrorScreen } from './FatalErrorScreen'

export interface FatalErrorHostProps {
  readonly children: ReactNode
}

export function FatalErrorHost({
  children,
}: FatalErrorHostProps) {
  const snapshot =
    useSyncExternalStore(
      failureCoordinator.subscribe,
      failureCoordinator.getSnapshot,
      failureCoordinator.getSnapshot,
    )

  if (snapshot.terminal) {
    return (
      <FatalErrorScreen
        additionalIncidentCount={
          snapshot.terminal
            .additionalIncidentCount
        }
        incident={
          snapshot.terminal.incident
        }
      />
    )
  }

  return (
    <FatalErrorBoundary>
      {children}
    </FatalErrorBoundary>
  )
}
`

  await writeText(FILES.fatalHost, source)
}

async function rewriteFatalScreen() {
  const source = `import {
  useMemo,
  useState,
} from 'react'
import {
  type FailureIncident,
} from '../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'

export interface FatalErrorScreenProps {
  readonly incident:
    FailureIncident

  readonly additionalIncidentCount?:
    number
}

export function FatalErrorScreen({
  incident,
  additionalIncidentCount = 0,
}: FatalErrorScreenProps) {
  const [copied, setCopied] =
    useState(false)

  const [
    copyFailed,
    setCopyFailed,
  ] = useState(false)

  const diagnostic = useMemo(
    () =>
      formatFailureDiagnostic(
        incident,
      ),
    [incident],
  )

  const copyDiagnostic =
    async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(
          diagnostic,
        )

        setCopied(true)
        setCopyFailed(false)
      } catch {
        setCopied(false)
        setCopyFailed(true)
      }
    }

  const title =
    incident.impact ===
    'native-fatal'
      ? '应用上次异常终止'
      : '应用遇到严重错误'

  return (
    <main
      aria-live="assertive"
      className="fatal-surface"
      role="alert"
    >
      <section className="fatal-content">
        <div
          aria-hidden="true"
          className="fatal-icon"
        >
          <WarningIcon />
        </div>

        <h1 className="fatal-title">
          {title}
        </h1>

        <p className="fatal-description">
          {incident.userMessage}
        </p>

        <p className="fatal-summary">
          {incident.code}
          {' · '}
          {incident.id}
        </p>

        {additionalIncidentCount >
        0 ? (
          <p className="fatal-secondary">
            此后还捕获到{' '}
            {additionalIncidentCount}{' '}
            个相关异常。
          </p>
        ) : null}

        <div className="fatal-actions">
          <button
            className="fatal-button fatal-button-primary"
            onClick={() =>
              window.location.reload()
            }
            type="button"
          >
            重新加载
          </button>

          <button
            className="fatal-button"
            onClick={() => {
              void copyDiagnostic()
            }}
            type="button"
          >
            {copied
              ? '已复制'
              : copyFailed
                ? '复制失败'
                : '复制诊断信息'}
          </button>
        </div>

        <details
          className="fatal-details"
          open={copyFailed}
        >
          <summary>
            查看诊断信息
          </summary>

          <pre className="fatal-diagnostic">
            {diagnostic}
          </pre>
        </details>
      </section>
    </main>
  )
}

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M12 8.5v4.25" />
      <path d="M12 16.25h.01" />
      <path d="M10.28 3.86 2.82 16.8a2 2 0 0 0 1.73 3h14.9a2 2 0 0 0 1.73-3L13.72 3.86a2 2 0 0 0-3.44 0Z" />
    </svg>
  )
}
`

  await writeText(FILES.fatalScreen, source)
}

async function rewritePreReactRenderer() {
  const file = resolvePath(FILES.preReact)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    "import { fatalIncidentController, isReactFatalHostMounted } from './fatal-runtime'",
    [
      "import { failureCoordinator, type FailureIncident } from '../application/failures/failure-coordinator'",
      "import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'",
      "import { isReactFatalHostMounted } from './fatal-runtime'",
    ].join('\n'),
  )

  source = source.replace(
    "import { formatFatalDiagnostic, type FatalIncident } from './fatal-incident'\n",
    '',
  )

  source = source.replaceAll('fatalIncidentController', 'failureCoordinator')

  source = source.replace(
    "  if (snapshot.status !== 'fatal') {\n    return\n  }\n\n  renderPreReactFatalScreen(snapshot.incident)",
    '  if (!snapshot.terminal) {\n    return\n  }\n\n  renderPreReactFatalScreen(snapshot.terminal.incident)',
  )

  source = source.replaceAll('FatalIncident', 'FailureIncident')

  source = source.replaceAll('formatFatalDiagnostic', 'formatFailureDiagnostic')

  await writeFile(file, normalizeText(source), 'utf8')
}

async function migrateFailureRuntimeConsumers() {
  const sourceRoot = resolvePath('apps/desktop/src')

  const files = await collectSourceFiles(sourceRoot)

  for (const file of files) {
    let source = await readFile(file, 'utf8')

    const original = source

    source = source.replaceAll('/failure-runtime', '/failure-coordinator')

    source = source.replaceAll("from './failure-runtime'", "from './failure-coordinator'")

    source = source.replaceAll('failureRuntime', 'failureCoordinator')

    source = source.replaceAll('.failure', '.incident')

    if (source !== original) {
      await writeFile(file, normalizeText(source), 'utf8')
    }
  }
}

async function migrateFatalCollectors() {
  const file = resolvePath(FILES.collectors)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    "import type { CreateFatalIncidentInput, FatalIncidentPhase } from './fatal-incident'",
    "import type { FailurePhase, TerminalFailureInput } from './fatal-runtime'",
  )

  source = source.replaceAll('CreateFatalIncidentInput', 'TerminalFailureInput')

  source = source.replaceAll('FatalIncidentPhase', 'FailurePhase')

  await writeFile(file, normalizeText(source), 'utf8')
}

async function removeLegacyFiles() {
  for (const relativePath of LEGACY_FILES) {
    await rm(resolvePath(relativePath), {
      force: true,
    })

    console.log(relativePath + ': removed.')
  }
}

async function writeArchitectureCheck() {
  const source = `#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const required = [
  'apps/desktop/src/application/failures/failure-coordinator.ts',
  'apps/desktop/src/application/failures/failure-diagnostic.ts',
  'apps/desktop/src/application/failures/failure-coordinator.test.ts',
  'apps/desktop/src/fatal/fatal-runtime.ts',
]

const forbidden = [
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/fatal/fatal-controller.ts',
  'apps/desktop/src/fatal/fatal-incident.ts',
]

for (const file of required) {
  if (
    !existsSync(
      path.join(ROOT, file),
    )
  ) {
    failures.push(
      'Missing unified failure file: ' +
        file,
    )
  }
}

for (const file of forbidden) {
  if (
    existsSync(
      path.join(ROOT, file),
    )
  ) {
    failures.push(
      'Legacy parallel failure system remains: ' +
        file,
    )
  }
}

if (failures.length === 0) {
  const coordinator = read(
    required[0],
  )

  requireText(
    coordinator,
    'readonly terminal:',
    'Coordinator does not own terminal state.',
  )

  requireText(
    coordinator,
    'readonly failures:',
    'Coordinator does not own recoverable state.',
  )

  requireText(
    coordinator,
    'readonly degradedFeatures:',
    'Coordinator does not own feature degradation.',
  )

  requireText(
    coordinator,
    'readonly quarantinedDocuments:',
    'Coordinator does not own document isolation.',
  )

  scanProductionSources()
}

if (failures.length > 0) {
  console.error(
    [
      'Failure architecture convergence checks failed:',
      ...failures.map(
        (failure) =>
          '- ' + failure,
      ),
    ].join('\\n'),
  )

  process.exitCode = 1
} else {
  console.log(
    'Failure architecture convergence checks passed.',
  )
}

function scanProductionSources() {
  for (
    const file of walk(
      'apps/desktop/src',
    )
  ) {
    if (
      !file.endsWith('.ts') &&
      !file.endsWith('.tsx')
    ) {
      continue
    }

    const source = read(file)

    for (const forbiddenText of [
      'FatalIncidentController',
      'fatalIncidentController',
      'FailureRuntime',
      'failureRuntime',
      'ClassifiedFailure',
    ]) {
      if (
        source.includes(
          forbiddenText,
        )
      ) {
        failures.push(
          'Legacy failure symbol ' +
            forbiddenText +
            ' remains in ' +
            file +
            '.',
        )
      }
    }
  }
}

function walk(relativeDirectory) {
  const result = []

  for (
    const entry of readdirSync(
      path.join(
        ROOT,
        relativeDirectory,
      ),
      {
        withFileTypes: true,
      },
    )
  ) {
    const relativePath =
      path.posix.join(
        relativeDirectory,
        entry.name,
      )

    if (entry.isDirectory()) {
      result.push(
        ...walk(relativePath),
      )
    } else {
      result.push(relativePath)
    }
  }

  return result
}

function read(relativePath) {
  return readFileSync(
    path.join(
      ROOT,
      relativePath,
    ),
    'utf8',
  )
}

function requireText(
  source,
  expected,
  failure,
) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}
`

  await writeText(FILES.architectureCheck, source)
}

async function writeArchitectureDecision() {
  const source = `# ADR-011: Unified failure coordinator

- Status: Accepted
- Date: 2026-07-24
- Scope: Complete renderer failure architecture

## Decision

Hybrid Canvas uses one FailureIncident model and one FailureCoordinator.

FailureCoordinator owns:

- recoverable operation failures;
- feature degradation;
- document quarantine;
- application terminal failure;
- native terminal failure;
- deduplication;
- occurrence counting;
- scope resolution;
- subscriber notification.

Fatal runtime is a source adapter only. It does not own state.

UI components are projections of the coordinator snapshot and do not classify
or store failures independently.

Failure diagnostics are generated once when the incident is created.

## Removed parallel systems

- FailureRuntime;
- FatalIncidentController;
- FatalIncident;
- separate fatal state store;
- separate non-terminal state store.

## Invariants

The first distinct terminal incident remains the primary terminal cause.

Recoverable failures cannot become terminal without an explicit terminal impact.

Document failures are isolated to their document scope.

Feature degradation remains after notification dismissal.

Native and renderer fatal failures use the same incident and diagnostic model.
`

  await writeText(FILES.adr, source)
}

async function consolidateArchitectureCommands() {
  const file = resolvePath(FILES.packageJson)

  const packageJson = JSON.parse(await readFile(file, 'utf8'))

  const current = packageJson.scripts?.['test:architecture']

  if (typeof current !== 'string') {
    throw new Error('package.json is missing test:architecture.')
  }

  const commands = current.split(' && ').filter((command) => {
    return !LEGACY_ARCHITECTURE_CHECKS.some((legacy) => command.includes(legacy))
  })

  const convergence = 'node tests/architecture/check-failure-architecture-convergence.mjs'

  if (!commands.includes(convergence)) {
    commands.push(convergence)
  }

  packageJson.scripts['test:architecture'] = commands.join(' && ')

  await writeFile(file, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')
}

async function collectSourceFiles(directory) {
  const result = []

  for (const entry of await readdir(directory, {
    withFileTypes: true,
  })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      result.push(...(await collectSourceFiles(entryPath)))

      continue
    }

    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      result.push(entryPath)
    }
  }

  return result
}

async function writeText(relativePath, content) {
  const absolutePath = resolvePath(relativePath)

  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  })

  await writeFile(absolutePath, normalizeText(content), 'utf8')

  console.log(relativePath + ': written.')
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath)
}

main().catch((error) => {
  console.error('')
  console.error('Failure architecture convergence failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
