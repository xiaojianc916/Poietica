import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  coordinator: 'apps/desktop/src/application/failures/failure-coordinator.ts',

  policy: 'apps/desktop/src/application/failures/failure-policy.ts',

  uiFeedback: 'apps/desktop/src/presentation/ui/ui-feedback.tsx',

  appShell: 'apps/desktop/src/presentation/AppShell.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  documentReporter: 'apps/desktop/src/application/failures/document-failure-reporter.ts',

  documentSurface: 'apps/desktop/src/presentation/workspace/DocumentQuarantineSurface.tsx',

  architectureCheck: 'tests/architecture/check-failure-architecture-convergence.mjs',
})

const FAILURE_CODE_REPLACEMENTS = Object.freeze({
  'canvas create failed': 'CANVAS_CREATE_FAILED',

  'canvas open failed': 'CANVAS_OPEN_FAILED',

  'canvas save failed': 'CANVAS_SAVE_FAILED',

  'canvas close transaction failed': 'CANVAS_CLOSE_FAILED',

  'main window minimize failed': 'WINDOW_MINIMIZE_UNAVAILABLE',

  'main window maximize failed': 'WINDOW_MAXIMIZE_UNAVAILABLE',

  'main window drag failed': 'WINDOW_DRAG_UNAVAILABLE',

  'open developer tools failed': 'DEVELOPER_TOOLS_UNAVAILABLE',

  'settings load failed': 'SETTINGS_LOAD_FAILED',

  'window maximize state query failed': 'WINDOW_STATE_QUERY_UNAVAILABLE',

  'window resize listener registration failed': 'WINDOW_RESIZE_SYNC_UNAVAILABLE',

  'main window close listener registration failed': 'WINDOW_CLOSE_LISTENER_UNAVAILABLE',
})

async function main() {
  await assertRepository()

  await writeFailurePolicy()
  await writeFailureCoordinator()
  await writeUiFeedback()
  await writeDocumentReporter()
  await writeDocumentSurface()

  await migrateAppShell()
  await migrateWorkspace()
  await strengthenArchitectureCheck()
  await verifyConvergence()

  console.log('')
  console.log('Failure policy convergence completed.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function writeFailurePolicy() {
  const source = `import type {
  FailureImpact,
  FailureRecovery,
  FailureScope,
} from '@hybrid-canvas/foundations-kernel'
import {
  failureCoordinator,
  type FailureIncident,
  type FailureSignal,
} from './failure-coordinator'

export const APPLICATION_FAILURE_CODES = [
  'CANVAS_CREATE_FAILED',
  'CANVAS_OPEN_FAILED',
  'CANVAS_SAVE_FAILED',
  'CANVAS_CLOSE_FAILED',
  'WINDOW_MINIMIZE_UNAVAILABLE',
  'WINDOW_MAXIMIZE_UNAVAILABLE',
  'WINDOW_DRAG_UNAVAILABLE',
  'DEVELOPER_TOOLS_UNAVAILABLE',
  'SETTINGS_LOAD_FAILED',
  'WINDOW_STATE_QUERY_UNAVAILABLE',
  'WINDOW_RESIZE_SYNC_UNAVAILABLE',
  'WINDOW_CLOSE_LISTENER_UNAVAILABLE',
  'DOCUMENT_EDITOR_SESSION_FATAL',
] as const

export type ApplicationFailureCode =
  (typeof APPLICATION_FAILURE_CODES)[number]

export type FailureReportContext =
  Readonly<Record<string, unknown>>

interface ApplicationFailurePolicy {
  readonly impact:
    FailureImpact

  readonly userMessage:
    string

  readonly recovery:
    FailureRecovery

  readonly scope: (
    context:
      FailureReportContext,
  ) => FailureScope
}

const APPLICATION_FAILURE_POLICIES = {
  CANVAS_CREATE_FAILED: {
    impact: 'recoverable',
    userMessage:
      '无法新建画布，请重试。',

    recovery: 'retry',

    scope: () => ({
      kind: 'operation',
      operation: 'create-canvas',
    }),
  },

  CANVAS_OPEN_FAILED: {
    impact: 'recoverable',
    userMessage:
      '无法打开画布，请检查文件后重试。',

    recovery: 'retry',

    scope: () => ({
      kind: 'operation',
      operation: 'open-canvas',
    }),
  },

  CANVAS_SAVE_FAILED: {
    impact: 'recoverable',
    userMessage:
      '画布保存失败，请重试。',

    recovery: 'retry',
    scope: documentOrOperationScope(
      'save-canvas',
    ),
  },

  CANVAS_CLOSE_FAILED: {
    impact: 'recoverable',
    userMessage:
      '无法关闭画布，请重试。',

    recovery: 'retry',
    scope: documentOrOperationScope(
      'close-canvas',
    ),
  },

  WINDOW_MINIMIZE_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '窗口最小化暂时不可用。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'window-controls',
    }),
  },

  WINDOW_MAXIMIZE_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '窗口最大化或还原暂时不可用。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'window-controls',
    }),
  },

  WINDOW_DRAG_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '窗口拖动暂时不可用。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'window-dragging',
    }),
  },

  DEVELOPER_TOOLS_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '开发者工具暂时不可用。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'developer-tools',
    }),
  },

  SETTINGS_LOAD_FAILED: {
    impact: 'feature-degraded',
    userMessage:
      '设置读取失败，当前会话将使用默认设置。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'settings',
    }),
  },

  WINDOW_STATE_QUERY_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '无法同步窗口状态。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'window-state-sync',
    }),
  },

  WINDOW_RESIZE_SYNC_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '窗口尺寸状态同步暂时不可用。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'window-state-sync',
    }),
  },

  WINDOW_CLOSE_LISTENER_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage:
      '窗口关闭协调暂时不可用。',

    recovery:
      'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId:
        'window-close-coordination',
    }),
  },

  DOCUMENT_EDITOR_SESSION_FATAL: {
    impact: 'document-fatal',
    userMessage:
      '当前画布遇到严重错误，已被隔离。其他画布仍可继续使用。',

    recovery:
      'close-document',

    scope: requireDocumentScope,
  },
} as const satisfies Readonly<
  Record<
    ApplicationFailureCode,
    ApplicationFailurePolicy
  >
>

export function reportFailure(
  code:
    ApplicationFailureCode,

  context:
    FailureReportContext,
): FailureIncident {
  const policy =
    APPLICATION_FAILURE_POLICIES[
      code
    ]

  const cause =
    context['cause']

  const componentStack =
    readOptionalString(
      context,
      'componentStack',
    )

  const source =
    readOptionalString(
      context,
      'source',
    )

  const line =
    readOptionalNumber(
      context,
      'line',
    )

  const column =
    readOptionalNumber(
      context,
      'column',
    )

  const signal: FailureSignal = {
    impact: policy.impact,
    code,
    userMessage:
      policy.userMessage,

    scope:
      policy.scope(context),

    recovery:
      policy.recovery,

    ...optionalProperty(
      'cause',
      cause,
    ),

    context:
      removeCause(context),

    diagnostic: {
      ...optionalProperty(
        'componentStack',
        componentStack,
      ),

      ...optionalProperty(
        'source',
        source,
      ),

      ...optionalProperty(
        'line',
        line,
      ),

      ...optionalProperty(
        'column',
        column,
      ),
    },
  }

  return failureCoordinator.report(
    signal,
  )
}

function documentOrOperationScope(
  operation: string,
): (
  context:
    FailureReportContext,
) => FailureScope {
  return (context) => {
    const documentId =
      readDocumentId(context)

    if (documentId) {
      return {
        kind: 'document',
        documentId,
      }
    }

    return {
      kind: 'operation',
      operation,
    }
  }
}

function requireDocumentScope(
  context:
    FailureReportContext,
): FailureScope {
  const documentId =
    readDocumentId(context)

  if (!documentId) {
    throw new Error(
      'DOCUMENT_EDITOR_SESSION_FATAL requires sessionId.',
    )
  }

  return {
    kind: 'document',
    documentId,
  }
}

function readDocumentId(
  context:
    FailureReportContext,
): string | undefined {
  const sessionId =
    context['sessionId']

  return (
    typeof sessionId ===
      'string' &&
    sessionId.length > 0
      ? sessionId
      : undefined
  )
}

function removeCause(
  context:
    FailureReportContext,
): Readonly<
  Record<string, unknown>
> {
  const entries =
    Object.entries(
      context,
    ).filter(
      ([key]) =>
        key !== 'cause',
    )

  return Object.fromEntries(
    entries,
  )
}

function readOptionalString(
  context:
    FailureReportContext,

  key: string,
): string | undefined {
  const value = context[key]

  return typeof value ===
    'string' &&
    value.length > 0
    ? value
    : undefined
}

function readOptionalNumber(
  context:
    FailureReportContext,

  key: string,
): number | undefined {
  const value = context[key]

  return typeof value ===
    'number'
    ? value
    : undefined
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

  await writeText(FILES.policy, source)
}

async function writeFailureCoordinator() {
  const source = `import {
  createClassifiedFailure,
  createFailureScopeKey,
  isTerminalFailureImpact,
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  type FailureScope,
  type NonTerminalFailureImpact,
  type TerminalFailureImpact,
} from '@hybrid-canvas/foundations-kernel'
import { error as reportDiagnosticError } from '@hybrid-canvas/foundations-observability'
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
  readonly noticeVisible: boolean
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

  readonly operations:
    readonly PresentedFailure[]

  readonly degradedFeatures:
    ReadonlyMap<
      string,
      PresentedFailure
    >

  readonly quarantinedDocuments:
    ReadonlyMap<
      string,
      PresentedFailure
    >
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

export type FailureListener =
  () => void

const EMPTY_SNAPSHOT:
  FailureSnapshot =
  Object.freeze({
    terminal: null,

    operations:
      Object.freeze([]),

    degradedFeatures:
      new Map(),

    quarantinedDocuments:
      new Map(),
  })

const MAX_OPERATION_FAILURES = 20

export class FailureCoordinator {
  private snapshot:
    FailureSnapshot =
    EMPTY_SNAPSHOT

  private readonly listeners =
    new Set<FailureListener>()

  private readonly operations:
    PresentedFailure[] = []

  private readonly degradedFeatures =
    new Map<
      string,
      PresentedFailure
    >()

  private readonly quarantinedDocuments =
    new Map<
      string,
      PresentedFailure
    >()

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

    this.recordDiagnostic(
      incident,
    )

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
    const operationIndex =
      this.operations.findIndex(
        (entry) =>
          entry.incident.id ===
          incidentId,
      )

    if (operationIndex >= 0) {
      this.operations.splice(
        operationIndex,
        1,
      )

      this.publish()
      return
    }

    if (
      hideScopedNotice(
        this.degradedFeatures,
        incidentId,
      )
    ) {
      this.publish()
    }
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

    for (
      let index =
        this.operations.length - 1;
      index >= 0;
      index -= 1
    ) {
      const entry =
        this.operations[index]

      if (
        entry &&
        createFailureScopeKey(
          entry.incident.scope,
        ) === scopeKey
      ) {
        this.operations.splice(
          index,
          1,
        )
      }
    }

    this.publish()
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
      this.snapshot =
        Object.freeze({
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

      this.emit()
      return current.incident
    }

    this.snapshot =
      Object.freeze({
        ...this.snapshot,

        terminal:
          Object.freeze({
            incident,
            additionalIncidentCount:
              0,
          }),
      })

    this.emit()
    return incident
  }

  private reportNonTerminal(
    incident:
      NonTerminalFailureIncident,
  ): NonTerminalFailureIncident {
    switch (incident.impact) {
      case 'recoverable':
        this.recordOperation(
          incident,
        )

        break

      case 'feature-degraded':
        if (
          incident.scope.kind !==
          'feature'
        ) {
          throw new Error(
            'Feature failure requires feature scope.',
          )
        }

        this.recordScoped(
          this.degradedFeatures,
          incident.scope.featureId,
          incident,
          true,
        )

        break

      case 'document-fatal':
        if (
          incident.scope.kind !==
          'document'
        ) {
          throw new Error(
            'Document failure requires document scope.',
          )
        }

        this.recordScoped(
          this.quarantinedDocuments,
          incident.scope.documentId,
          incident,
          false,
        )

        break
    }

    this.publish()
    return incident
  }

  private recordOperation(
    incident:
      NonTerminalFailureIncident,
  ): void {
    const existingIndex =
      this.operations.findIndex(
        (entry) =>
          entry.incident
            .fingerprint ===
          incident.fingerprint,
      )

    const existing =
      existingIndex >= 0
        ? this.operations[
            existingIndex
          ]
        : undefined

    if (existingIndex >= 0) {
      this.operations.splice(
        existingIndex,
        1,
      )
    }

    this.operations.push(
      Object.freeze({
        incident,
        occurrences:
          (existing?.occurrences ??
            0) + 1,

        noticeVisible: true,
      }),
    )

    if (
      this.operations.length >
      MAX_OPERATION_FAILURES
    ) {
      this.operations.splice(
        0,
        this.operations.length -
          MAX_OPERATION_FAILURES,
      )
    }
  }

  private recordScoped(
    target: Map<
      string,
      PresentedFailure
    >,

    key: string,

    incident:
      NonTerminalFailureIncident,

    noticeVisible: boolean,
  ): void {
    const existing =
      target.get(key)

    target.set(
      key,
      Object.freeze({
        incident,
        occurrences:
          (existing?.occurrences ??
            0) + 1,

        noticeVisible,
      }),
    )
  }

  private publish(): void {
    this.snapshot =
      Object.freeze({
        terminal:
          this.snapshot.terminal,

        operations:
          Object.freeze([
            ...this.operations,
          ]),

        degradedFeatures:
          new Map(
            this.degradedFeatures,
          ),

        quarantinedDocuments:
          new Map(
            this
              .quarantinedDocuments,
          ),
      })

    this.emit()
  }

  private recordDiagnostic(
    incident:
      FailureIncident,
  ): void {
    try {
      reportDiagnosticError(
        incident.technicalMessage,
        {
          ...incident.context,

          failureId:
            incident.id,

          failureCode:
            incident.code,

          failureImpact:
            incident.impact,

          failureRecovery:
            incident.recovery,

          failureScope:
            createFailureScopeKey(
              incident.scope,
            ),
        },
      )
    } catch (error: unknown) {
      try {
        console.error(
          '[Hybrid Canvas] Failure diagnostic reporting failed',
          error,
        )
      } catch {
        // No further safe fallback.
      }
    }
  }

  private emit(): void {
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

function hideScopedNotice(
  failures: Map<
    string,
    PresentedFailure
  >,

  incidentId: string,
): boolean {
  for (
    const [
      key,
      entry,
    ] of failures
  ) {
    if (
      entry.incident.id !==
      incidentId
    ) {
      continue
    }

    failures.set(
      key,
      Object.freeze({
        ...entry,
        noticeVisible: false,
      }),
    )

    return true
  }

  return false
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

  await writeText(FILES.coordinator, source)
}

async function writeUiFeedback() {
  const source = `import type {
  FailureImpact,
} from '@hybrid-canvas/foundations-kernel'
import {
  DangerCircle,
  X,
} from '@mynaui/icons-react'
import {
  useEffect,
  useSyncExternalStore,
} from 'react'
import {
  failureCoordinator,
  type PresentedFailure,
} from '../../application/failures/failure-coordinator'

export function UiFeedbackRegion() {
  const snapshot =
    useSyncExternalStore(
      failureCoordinator.subscribe,
      failureCoordinator.getSnapshot,
      failureCoordinator.getSnapshot,
    )

  const visible =
    selectVisibleFailures(
      snapshot.operations,

      snapshot.degradedFeatures,
    ).slice(-3)

  useEffect(() => {
    const timers =
      visible.map((entry) => {
        const duration =
          entry.incident.impact ===
          'feature-degraded'
            ? 9_000
            : 5_500

        return window.setTimeout(
          () => {
            failureCoordinator.dismiss(
              entry.incident.id,
            )
          },
          duration,
        )
      })

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [visible])

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className={[
        'pointer-events-none',
        'fixed bottom-4 right-4',
        'z-[var(--ui-z-toast)]',
        'grid gap-2',
        'w-[min(380px,calc(100vw-32px))]',
      ].join(' ')}
    >
      {visible.map((entry) => {
        const incident =
          entry.incident

        return (
          <div
            className={[
              'pointer-events-auto',
              'flex items-start gap-3',
              'rounded-lg border',
              borderClass(
                incident.impact,
              ),
              'bg-background p-3',
              'text-sm shadow-xl',
            ].join(' ')}
            key={incident.id}
            role="alert"
          >
            <DangerCircle
              aria-hidden="true"
              className={[
                'mt-0.5 size-4',
                'shrink-0',
                iconClass(
                  incident.impact,
                ),
              ].join(' ')}
            />

            <div className="grid min-w-0 flex-1 gap-1">
              <span className="leading-5">
                {
                  incident.userMessage
                }
              </span>

              <span className="text-xs text-muted-foreground">
                {impactLabel(
                  incident.impact,
                )}
                {' · '}
                {incident.code}

                {entry.occurrences > 1
                  ? ' · ' +
                    String(
                      entry.occurrences,
                    ) +
                    ' 次'
                  : ''}
              </span>
            </div>

            <button
              aria-label="关闭提示"
              className={[
                'grid size-7',
                'place-items-center',
                'rounded-md',
                'text-muted-foreground',
                'hover:bg-accent',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={() => {
                failureCoordinator.dismiss(
                  incident.id,
                )
              }}
              type="button"
            >
              <X
                aria-hidden="true"
                className="size-3.5"
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function selectVisibleFailures(
  operations:
    readonly PresentedFailure[],

  degradedFeatures:
    ReadonlyMap<
      string,
      PresentedFailure
    >,
): PresentedFailure[] {
  return [
    ...operations,

    ...[
      ...degradedFeatures.values(),
    ].filter(
      (entry) =>
        entry.noticeVisible,
    ),
  ]
}

function impactLabel(
  impact: FailureImpact,
): string {
  switch (impact) {
    case 'recoverable':
      return '操作失败'

    case 'feature-degraded':
      return '功能受限'

    case 'document-fatal':
      return '文档已隔离'

    case 'application-fatal':
      return '应用错误'

    case 'native-fatal':
      return '原生错误'
  }
}

function borderClass(
  impact: FailureImpact,
): string {
  return impact ===
    'feature-degraded'
    ? 'border-warning/40'
    : 'border-destructive/30'
}

function iconClass(
  impact: FailureImpact,
): string {
  return impact ===
    'feature-degraded'
    ? 'text-warning'
    : 'text-destructive'
}
`

  await writeText(FILES.uiFeedback, source)
}

async function writeDocumentReporter() {
  const source = `import type { EditorSessionFailure } from '@hybrid-canvas/canvas/react'
import { reportFailure } from './failure-policy'

export function reportDocumentFatal(
  failure: EditorSessionFailure,
): void {
  reportFailure(
    'DOCUMENT_EDITOR_SESSION_FATAL',
    {
      cause: failure.error,

      sessionId:
        failure.sessionId,

      errorName:
        failure.error.name,

      ...optionalProperty(
        'stack',
        failure.error.stack,
      ),

      ...optionalProperty(
        'componentStack',
        failure.componentStack,
      ),

      collector:
        'editor-session-boundary',

      operation:
        'render-editor-session',
    },
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

  await writeText(FILES.documentReporter, source)
}

async function writeDocumentSurface() {
  const source = `import { DangerTriangle } from '@mynaui/icons-react'
import {
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { failureCoordinator } from '../../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../../application/failures/failure-diagnostic'

export interface DocumentQuarantineSurfaceProps {
  readonly sessionId: string
  readonly onClose: () => void
}

export function DocumentQuarantineSurface({
  sessionId,
  onClose,
}: DocumentQuarantineSurfaceProps) {
  const snapshot =
    useSyncExternalStore(
      failureCoordinator.subscribe,
      failureCoordinator.getSnapshot,
      failureCoordinator.getSnapshot,
    )

  const [
    copyState,
    setCopyState,
  ] = useState<
    'idle' | 'copied' | 'failed'
  >('idle')

  const failure =
    snapshot.quarantinedDocuments.get(
      sessionId,
    )?.incident

  const diagnostic = useMemo(
    () =>
      failure
        ? formatFailureDiagnostic(
            failure,
          )
        : [
            'Hybrid Canvas Document Failure',
            '',
            'Session ID: ' +
              sessionId,

            '错误码: DOCUMENT_EDITOR_SESSION_FATAL',
          ].join('\\n'),

    [failure, sessionId],
  )

  const copyDiagnostic =
    async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(
          diagnostic,
        )

        setCopyState('copied')
      } catch {
        setCopyState('failed')
      }
    }

  return (
    <section
      aria-label="当前画布不可用"
      aria-live="assertive"
      className="grid size-full place-items-center px-6 py-10"
      role="alert"
    >
      <div className="flex w-full max-w-md items-start gap-3">
        <DangerTriangle
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-destructive"
        />

        <div className="grid min-w-0 flex-1 gap-3">
          <div className="grid gap-1">
            <h1 className="text-base font-medium tracking-tight">
              此画布暂时无法继续
            </h1>

            <p className="text-sm leading-6 text-muted-foreground">
              为保护其他画布，当前画布已停止运行。其他画布不受影响。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onClose}
              type="button"
            >
              关闭画布
            </button>

            <button
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                void copyDiagnostic()
              }}
              type="button"
            >
              {copyState ===
              'copied'
                ? '已复制诊断信息'
                : copyState ===
                    'failed'
                  ? '复制失败'
                  : '复制诊断信息'}
            </button>
          </div>

          <p className="text-xs text-muted-foreground/70">
            {failure?.code ??
              'DOCUMENT_EDITOR_SESSION_FATAL'}
          </p>
        </div>
      </div>
    </section>
  )
}
`

  await writeText(FILES.documentSurface, source)
}

async function migrateAppShell() {
  const file = resolvePath(FILES.appShell)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    "import { error as reportDiagnosticError } from '@hybrid-canvas/foundations-observability'\n",
    '',
  )

  source = source.replace(
    "import { failureCoordinator } from '../application/failures/failure-coordinator'",
    [
      "import { failureCoordinator } from '../application/failures/failure-coordinator'",
      "import { reportFailure } from '../application/failures/failure-policy'",
    ].join('\n'),
  )

  source = source.replace(
    "import { reportUiFailure as reportFailure, UiFeedbackRegion } from './ui/ui-feedback'",
    "import { UiFeedbackRegion } from './ui/ui-feedback'",
  )

  source = source.replaceAll('reportDiagnosticError(', 'reportFailure(')

  source = replaceFailureCodes(source)

  source = source.replace(
    `  const [failedCanvasTitle, setFailedCanvasTitle] = useState<string | null>(null)

`,
    '',
  )

  source = source.replaceAll('        setFailedCanvasTitle(null)\n', '')

  source = source.replaceAll('        setFailedCanvasTitle(title)\n', '')

  source = source.replace(
    'createFeatureAvailability(failureSnapshot.degradedFeatures)',
    'createFeatureAvailability([...failureSnapshot.degradedFeatures.keys()])',
  )

  source = source.replace(
    'degradedFeatures={failureSnapshot.degradedFeatures}',
    'degradedFeatures={[...failureSnapshot.degradedFeatures.keys()]}',
  )

  source = removeCreateFailureDialog(source)

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.appShell + ': migrated.')
}

async function migrateWorkspace() {
  const file = resolvePath(FILES.workspace)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    "import { reportUiFailure as reportFailure } from '../ui/ui-feedback'",
    "import { reportFailure } from '../../application/failures/failure-policy'",
  )

  source = replaceFailureCodes(source)

  source = source.replace(
    'for (const sessionId of failureSnapshot.quarantinedDocuments) {',
    'for (const sessionId of failureSnapshot.quarantinedDocuments.keys()) {',
  )

  source = source.replace(
    'quarantinedSessionIds: failureSnapshot.quarantinedDocuments,',
    'quarantinedSessionIds: [...failureSnapshot.quarantinedDocuments.keys()],',
  )

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.workspace + ': migrated.')
}

async function strengthenArchitectureCheck() {
  const file = resolvePath(FILES.architectureCheck)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    `  'apps/desktop/src/application/failures/failure-diagnostic.ts',`,
    `  'apps/desktop/src/application/failures/failure-diagnostic.ts',
  'apps/desktop/src/application/failures/failure-policy.ts',`,
  )

  source = source.replace(
    `      'failureRuntime',`,
    `      'failureRuntime',
      'UI_FAILURE_POLICIES',
      'reportUiFailure',`,
  )

  await writeFile(file, normalizeText(source), 'utf8')
}

async function verifyConvergence() {
  const files = [FILES.appShell, FILES.workspace, FILES.uiFeedback, FILES.documentReporter]

  const violations = []

  for (const relativePath of files) {
    const source = await readFile(resolvePath(relativePath), 'utf8')

    for (const forbidden of [
      'reportUiFailure',
      'UI_FAILURE_POLICIES',
      'reportDiagnosticError',
      'snapshot.failures',
    ]) {
      if (source.includes(forbidden)) {
        violations.push(relativePath + ': ' + forbidden)
      }
    }
  }

  const coordinator = await readFile(resolvePath(FILES.coordinator), 'utf8')

  for (const required of [
    'readonly operations:',
    'readonly degradedFeatures:',
    'readonly quarantinedDocuments:',
    'reportDiagnosticError(',
  ]) {
    if (!coordinator.includes(required)) {
      violations.push(FILES.coordinator + ': missing ' + required)
    }
  }

  if (violations.length > 0) {
    throw new Error(
      [
        'Failure policy convergence verification failed:',
        ...violations.map((violation) => '- ' + violation),
      ].join('\n'),
    )
  }
}

function replaceFailureCodes(source) {
  let result = source

  for (const [oldName, code] of Object.entries(FAILURE_CODE_REPLACEMENTS)) {
    result = result.replaceAll("'" + oldName + "'", "'" + code + "'")
  }

  return result
}

function removeCreateFailureDialog(source) {
  const start = source.indexOf(
    `      <ConfirmationDialog
        cancelLabel="取消"
        confirmLabel="重试"`,
  )

  if (start === -1) {
    return source
  }

  const next = source.indexOf(
    `      <ConfirmationDialog
        confirmLabel="放弃全部并退出"`,
    start,
  )

  if (next === -1) {
    throw new Error('Could not locate termination confirmation dialog.')
  }

  return source.slice(0, start) + source.slice(next)
}

async function writeText(relativePath, source) {
  await writeFile(resolvePath(relativePath), normalizeText(source), 'utf8')

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
  console.error('Failure policy convergence failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
