import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  rootPackage: 'package.json',

  kernelPackage: 'foundations/kernel/package.json',

  kernelPublicApi: 'foundations/kernel/src/public-api.ts',

  failurePolicy: 'foundations/kernel/src/failure-policy.ts',

  failurePolicyTest: 'foundations/kernel/src/failure-policy.test.ts',

  desktopPackage: 'apps/desktop/package.json',

  failureRuntime: 'apps/desktop/src/application/failures/failure-runtime.ts',

  failureRuntimeTest: 'apps/desktop/src/application/failures/failure-runtime.test.ts',

  uiFeedback: 'apps/desktop/src/presentation/ui/ui-feedback.tsx',

  appShell: 'apps/desktop/src/presentation/AppShell.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  fatalRuntime: 'apps/desktop/src/fatal/fatal-runtime.ts',

  architectureCheck: 'tests/architecture/check-failure-severity-architecture.mjs',

  adr: 'docs/adr/ADR-007-application-failure-severity.md',
})

async function main() {
  await assertRepository()

  await writeFailurePolicy()
  await writeFailurePolicyTests()
  await exportFailurePolicy()

  await addDesktopKernelDependency()
  await writeFailureRuntime()
  await writeFailureRuntimeTests()

  await rewriteUiFeedback()
  await migrateUiFailureCallSites()
  await unifyFatalImpactType()

  await writeArchitectureCheck()
  await writeArchitectureDecision()
  await registerArchitectureCheck()

  console.log('')
  console.log('Application failure severity architecture refactor applied.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.rootPackage), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function writeFailurePolicy() {
  const source = `export const FAILURE_IMPACTS = [
  'recoverable',
  'feature-degraded',
  'document-fatal',
  'application-fatal',
  'native-fatal',
] as const

export type FailureImpact =
  (typeof FAILURE_IMPACTS)[number]

export type NonTerminalFailureImpact = Extract<
  FailureImpact,
  | 'recoverable'
  | 'feature-degraded'
  | 'document-fatal'
>

export type TerminalFailureImpact = Extract<
  FailureImpact,
  | 'application-fatal'
  | 'native-fatal'
>

export type FailureRecovery =
  | 'retry'
  | 'dismiss'
  | 'disable-feature'
  | 'close-document'
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
      readonly kind: 'document'
      readonly documentId: string
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
  readonly context?: Readonly<
    Record<string, unknown>
  >
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
  readonly context: Readonly<
    Record<string, unknown>
  >
}

const RECOVERY_BY_IMPACT = {
  recoverable: new Set<FailureRecovery>([
    'retry',
    'dismiss',
    'none',
  ]),

  'feature-degraded':
    new Set<FailureRecovery>([
      'retry',
      'dismiss',
      'disable-feature',
      'none',
    ]),

  'document-fatal':
    new Set<FailureRecovery>([
      'retry',
      'close-document',
      'none',
    ]),

  'application-fatal':
    new Set<FailureRecovery>([
      'reload',
      'restart',
      'exit',
      'none',
    ]),

  'native-fatal':
    new Set<FailureRecovery>([
      'restart',
      'exit',
      'none',
    ]),
} satisfies Record<
  FailureImpact,
  ReadonlySet<FailureRecovery>
>

let failureSequence = 0

export function createClassifiedFailure(
  input: ClassifiedFailureInput,
): ClassifiedFailure {
  validateFailurePolicy(input)

  const occurredAt =
    new Date().toISOString()

  const scopeKey =
    createFailureScopeKey(input.scope)

  const fingerprint = [
    input.impact,
    input.code,
    scopeKey,
    input.technicalMessage,
  ].join('|')

  return Object.freeze({
    id: createFailureId(),
    fingerprint,
    impact: input.impact,
    code: input.code,
    userMessage: input.userMessage,
    technicalMessage:
      input.technicalMessage,
    scope: Object.freeze(input.scope),
    recovery: input.recovery,
    occurredAt,
    ...optionalProperty(
      'cause',
      input.cause,
    ),
    context: Object.freeze({
      ...(input.context ?? {}),
    }),
  })
}

export function isTerminalFailureImpact(
  impact: FailureImpact,
): impact is TerminalFailureImpact {
  return (
    impact === 'application-fatal' ||
    impact === 'native-fatal'
  )
}

export function isNonTerminalFailureImpact(
  impact: FailureImpact,
): impact is NonTerminalFailureImpact {
  return !isTerminalFailureImpact(
    impact,
  )
}

export function createFailureScopeKey(
  scope: FailureScope,
): string {
  switch (scope.kind) {
    case 'operation':
      return (
        'operation:' +
        scope.operation
      )

    case 'feature':
      return (
        'feature:' +
        scope.featureId
      )

    case 'document':
      return (
        'document:' +
        scope.documentId
      )

    case 'application':
      return 'application'

    case 'native-process':
      return 'native-process'
  }
}

export function validateFailurePolicy(
  input: ClassifiedFailureInput,
): void {
  if (
    input.code.trim().length === 0
  ) {
    throw new Error(
      'Failure code must not be empty.',
    )
  }

  if (
    input.userMessage.trim().length ===
    0
  ) {
    throw new Error(
      'Failure userMessage must not be empty.',
    )
  }

  if (
    input.technicalMessage.trim()
      .length === 0
  ) {
    throw new Error(
      'Failure technicalMessage must not be empty.',
    )
  }

  const allowedRecovery =
    RECOVERY_BY_IMPACT[input.impact]

  if (
    !allowedRecovery.has(
      input.recovery,
    )
  ) {
    throw new Error(
      [
        'Recovery',
        input.recovery,
        'is invalid for impact',
        input.impact + '.',
      ].join(' '),
    )
  }

  switch (input.impact) {
    case 'recoverable': {
      if (
        input.scope.kind ===
          'application' ||
        input.scope.kind ===
          'native-process'
      ) {
        throw new Error(
          'Recoverable failure cannot own an application or native-process scope.',
        )
      }

      return
    }

    case 'feature-degraded': {
      if (
        input.scope.kind !==
        'feature'
      ) {
        throw new Error(
          'Feature-degraded failure requires a feature scope.',
        )
      }

      return
    }

    case 'document-fatal': {
      if (
        input.scope.kind !==
        'document'
      ) {
        throw new Error(
          'Document-fatal failure requires a document scope.',
        )
      }

      return
    }

    case 'application-fatal': {
      if (
        input.scope.kind !==
        'application'
      ) {
        throw new Error(
          'Application-fatal failure requires an application scope.',
        )
      }

      return
    }

    case 'native-fatal': {
      if (
        input.scope.kind !==
        'native-process'
      ) {
        throw new Error(
          'Native-fatal failure requires a native-process scope.',
        )
      }
    }
  }
}

function createFailureId(): string {
  failureSequence += 1

  const randomPart =
    globalThis.crypto
      ?.randomUUID?.() ??
    Math.random()
      .toString(36)
      .slice(2)

  return [
    'failure',
    Date.now().toString(36),
    failureSequence.toString(36),
    randomPart,
  ].join('-')
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

  await writeText(FILES.failurePolicy, source)
}

async function writeFailurePolicyTests() {
  const source = `import {
  describe,
  expect,
  it,
} from 'vitest'
import {
  createClassifiedFailure,
  createFailureScopeKey,
  isNonTerminalFailureImpact,
  isTerminalFailureImpact,
} from './failure-policy'

describe('application failure policy', () => {
  it('distinguishes terminal impacts', () => {
    expect(
      isTerminalFailureImpact(
        'application-fatal',
      ),
    ).toBe(true)

    expect(
      isTerminalFailureImpact(
        'native-fatal',
      ),
    ).toBe(true)

    expect(
      isNonTerminalFailureImpact(
        'recoverable',
      ),
    ).toBe(true)

    expect(
      isNonTerminalFailureImpact(
        'document-fatal',
      ),
    ).toBe(true)
  })

  it('creates stable scope keys', () => {
    expect(
      createFailureScopeKey({
        kind: 'feature',
        featureId: 'settings',
      }),
    ).toBe('feature:settings')

    expect(
      createFailureScopeKey({
        kind: 'document',
        documentId: 'document-1',
      }),
    ).toBe(
      'document:document-1',
    )
  })

  it('creates unique IDs and stable fingerprints', () => {
    const input = {
      impact: 'recoverable' as const,
      code:
        'DOCUMENT_SAVE_FAILED',
      userMessage:
        '保存失败，请重试。',
      technicalMessage:
        'document save failed',
      scope: {
        kind: 'document' as const,
        documentId: 'document-1',
      },
      recovery: 'retry' as const,
    }

    const first =
      createClassifiedFailure(input)

    const second =
      createClassifiedFailure(input)

    expect(first.id).not.toBe(
      second.id,
    )

    expect(first.fingerprint).toBe(
      second.fingerprint,
    )
  })

  it('rejects feature degradation without feature ownership', () => {
    expect(() => {
      createClassifiedFailure({
        impact:
          'feature-degraded',
        code:
          'SETTINGS_UNAVAILABLE',
        userMessage:
          '设置暂时不可用。',
        technicalMessage:
          'settings unavailable',
        scope: {
          kind: 'operation',
          operation:
            'load-settings',
        },
        recovery:
          'disable-feature',
      })
    }).toThrow(
      'Feature-degraded failure requires a feature scope.',
    )
  })

  it('rejects document fatal without document ownership', () => {
    expect(() => {
      createClassifiedFailure({
        impact: 'document-fatal',
        code:
          'DOCUMENT_CORRUPTED',
        userMessage:
          '文档无法继续使用。',
        technicalMessage:
          'document invariant failed',
        scope: {
          kind: 'application',
        },
        recovery:
          'close-document',
      })
    }).toThrow(
      'Document-fatal failure requires a document scope.',
    )
  })

  it('rejects terminal recovery on recoverable failure', () => {
    expect(() => {
      createClassifiedFailure({
        impact: 'recoverable',
        code:
          'OPERATION_FAILED',
        userMessage:
          '操作失败。',
        technicalMessage:
          'operation failed',
        scope: {
          kind: 'operation',
          operation: 'save',
        },
        recovery: 'reload',
      })
    }).toThrow(
      'Recovery reload is invalid for impact recoverable.',
    )
  })
})
`

  await writeText(FILES.failurePolicyTest, source)
}

async function exportFailurePolicy() {
  const packagePath = resolvePath(FILES.kernelPackage)

  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))

  packageJson.exports['./failure-policy'] = './src/failure-policy.ts'

  await writeJson(packagePath, packageJson)

  const publicApiPath = resolvePath(FILES.kernelPublicApi)

  let source = await readFile(publicApiPath, 'utf8')

  const exportBlock = `export {
  createClassifiedFailure,
  createFailureScopeKey,
  FAILURE_IMPACTS,
  isNonTerminalFailureImpact,
  isTerminalFailureImpact,
  validateFailurePolicy,
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  type FailureImpact,
  type FailureRecovery,
  type FailureScope,
  type NonTerminalFailureImpact,
  type TerminalFailureImpact,
} from './failure-policy'
`

  if (!source.includes("from './failure-policy'")) {
    source = source.trimEnd() + '\n\n' + exportBlock
  }

  await writeFile(publicApiPath, normalizeText(source), 'utf8')
}

async function addDesktopKernelDependency() {
  const file = resolvePath(FILES.desktopPackage)

  const packageJson = JSON.parse(await readFile(file, 'utf8'))

  packageJson.dependencies['@hybrid-canvas/foundations-kernel'] = 'workspace:*'

  packageJson.dependencies = Object.fromEntries(
    Object.entries(packageJson.dependencies).sort(([left], [right]) => left.localeCompare(right)),
  )

  await writeJson(file, packageJson)
}

async function writeFailureRuntime() {
  const source = `import {
  createClassifiedFailure,
  createFailureScopeKey,
  isTerminalFailureImpact,
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  type FailureScope,
  type NonTerminalFailureImpact,
} from '@hybrid-canvas/foundations-kernel'

export interface PresentedFailure {
  readonly failure: ClassifiedFailure
  readonly occurrences: number
}

export interface FailureRuntimeSnapshot {
  readonly failures:
    readonly PresentedFailure[]

  readonly degradedFeatures:
    readonly string[]

  readonly quarantinedDocuments:
    readonly string[]
}

export type FailureRuntimeListener =
  () => void

export type NonTerminalFailureInput =
  ClassifiedFailureInput & {
    readonly impact:
      NonTerminalFailureImpact
  }

const EMPTY_SNAPSHOT: FailureRuntimeSnapshot =
  Object.freeze({
    failures: Object.freeze([]),
    degradedFeatures:
      Object.freeze([]),
    quarantinedDocuments:
      Object.freeze([]),
  })

const MAX_PRESENTED_FAILURES = 20

export class FailureRuntime {
  private snapshot:
    FailureRuntimeSnapshot =
    EMPTY_SNAPSHOT

  private readonly listeners =
    new Set<FailureRuntimeListener>()

  private readonly degradedFeatures =
    new Set<string>()

  private readonly quarantinedDocuments =
    new Set<string>()

  readonly getSnapshot =
    (): FailureRuntimeSnapshot => {
      return this.snapshot
    }

  readonly subscribe = (
    listener: FailureRuntimeListener,
  ): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  report(
    input: NonTerminalFailureInput,
  ): ClassifiedFailure {
    const failure =
      createClassifiedFailure(input)

    if (
      isTerminalFailureImpact(
        failure.impact,
      )
    ) {
      throw new Error(
        'Terminal failures belong to the fatal incident runtime.',
      )
    }

    this.recordOwnedDegradation(
      failure,
    )

    const existing =
      this.snapshot.failures.find(
        (entry) =>
          entry.failure.fingerprint ===
          failure.fingerprint,
      )

    const retained =
      this.snapshot.failures.filter(
        (entry) =>
          entry.failure.fingerprint !==
          failure.fingerprint,
      )

    const presented:
      PresentedFailure = Object.freeze({
        failure,
        occurrences:
          (existing?.occurrences ?? 0) +
          1,
      })

    this.publish({
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

    return failure
  }

  dismiss(
    failureId: string,
  ): void {
    const failures =
      this.snapshot.failures.filter(
        (entry) =>
          entry.failure.id !==
          failureId,
      )

    if (
      failures.length ===
      this.snapshot.failures.length
    ) {
      return
    }

    this.publish({
      failures,
      degradedFeatures:
        this.snapshot
          .degradedFeatures,
      quarantinedDocuments:
        this.snapshot
          .quarantinedDocuments,
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
      failures:
        this.snapshot.failures.filter(
          (entry) =>
            createFailureScopeKey(
              entry.failure.scope,
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

  private recordOwnedDegradation(
    failure: ClassifiedFailure,
  ): void {
    if (
      failure.impact ===
        'feature-degraded' &&
      failure.scope.kind ===
        'feature'
    ) {
      this.degradedFeatures.add(
        failure.scope.featureId,
      )
    }

    if (
      failure.impact ===
        'document-fatal' &&
      failure.scope.kind ===
        'document'
    ) {
      this.quarantinedDocuments.add(
        failure.scope.documentId,
      )
    }
  }

  private publish(
    snapshot:
      FailureRuntimeSnapshot,
  ): void {
    this.snapshot = Object.freeze({
      failures: Object.freeze([
        ...snapshot.failures,
      ]),

      degradedFeatures:
        Object.freeze([
          ...snapshot.degradedFeatures,
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
            '[Hybrid Canvas] Failure runtime listener failed',
            error,
          )
        } catch {
          // No further recovery path.
        }
      }
    }
  }
}

export const failureRuntime =
  new FailureRuntime()
`

  await writeText(FILES.failureRuntime, source)
}

async function writeFailureRuntimeTests() {
  const source = `import {
  describe,
  expect,
  it,
} from 'vitest'
import { FailureRuntime } from './failure-runtime'

describe('non-terminal failure runtime', () => {
  it('deduplicates repeated failures while counting occurrences', () => {
    const runtime =
      new FailureRuntime()

    const input = {
      impact: 'recoverable' as const,
      code:
        'DOCUMENT_SAVE_FAILED',
      userMessage:
        '保存失败，请重试。',
      technicalMessage:
        'canvas save failed',
      scope: {
        kind: 'document' as const,
        documentId: 'document-1',
      },
      recovery: 'retry' as const,
    }

    runtime.report(input)
    runtime.report(input)

    const snapshot =
      runtime.getSnapshot()

    expect(
      snapshot.failures,
    ).toHaveLength(1)

    expect(
      snapshot.failures[0]
        ?.occurrences,
    ).toBe(2)
  })

  it('tracks degraded features independently from notices', () => {
    const runtime =
      new FailureRuntime()

    const failure =
      runtime.report({
        impact:
          'feature-degraded',
        code:
          'SETTINGS_UNAVAILABLE',
        userMessage:
          '设置暂时不可用。',
        technicalMessage:
          'settings load failed',
        scope: {
          kind: 'feature',
          featureId: 'settings',
        },
        recovery:
          'disable-feature',
      })

    runtime.dismiss(failure.id)

    expect(
      runtime.getSnapshot()
        .failures,
    ).toHaveLength(0)

    expect(
      runtime.getSnapshot()
        .degradedFeatures,
    ).toContain('settings')

    runtime.resolveScope({
      kind: 'feature',
      featureId: 'settings',
    })

    expect(
      runtime.getSnapshot()
        .degradedFeatures,
    ).not.toContain('settings')
  })

  it('tracks document quarantine separately from application fatal state', () => {
    const runtime =
      new FailureRuntime()

    runtime.report({
      impact: 'document-fatal',
      code:
        'DOCUMENT_STATE_UNSAFE',
      userMessage:
        '当前文档无法安全继续。',
      technicalMessage:
        'document invariant failed',
      scope: {
        kind: 'document',
        documentId: 'document-1',
      },
      recovery:
        'close-document',
    })

    expect(
      runtime.getSnapshot()
        .quarantinedDocuments,
    ).toContain('document-1')
  })
})
`

  await writeText(FILES.failureRuntimeTest, source)
}

async function rewriteUiFeedback() {
  const source = `import type {
  FailureImpact,
  FailureRecovery,
  FailureScope,
} from '@hybrid-canvas/foundations-kernel'
import { error as reportDiagnosticError } from '@hybrid-canvas/foundations-observability'
import {
  DangerCircle,
  X,
} from '@mynaui/icons-react'
import {
  useEffect,
  useSyncExternalStore,
} from 'react'
import {
  failureRuntime,
  type NonTerminalFailureInput,
} from '../../application/failures/failure-runtime'

interface UiFailurePolicy {
  readonly impact:
    NonTerminalFailureInput['impact']

  readonly code: string
  readonly userMessage: string
  readonly recovery: FailureRecovery

  readonly scope: (
    context: Readonly<
      Record<string, unknown>
    >,
  ) => FailureScope
}

const UI_FAILURE_POLICIES = {
  'canvas create failed': {
    impact: 'recoverable',
    code:
      'CANVAS_CREATE_FAILED',
    userMessage:
      '无法新建画布，请重试。',
    recovery: 'retry',
    scope: () => ({
      kind: 'operation',
      operation: 'create-canvas',
    }),
  },

  'canvas open failed': {
    impact: 'recoverable',
    code:
      'CANVAS_OPEN_FAILED',
    userMessage:
      '无法打开画布，请检查文件后重试。',
    recovery: 'retry',
    scope: () => ({
      kind: 'operation',
      operation: 'open-canvas',
    }),
  },

  'canvas save failed': {
    impact: 'recoverable',
    code:
      'CANVAS_SAVE_FAILED',
    userMessage:
      '画布保存失败，请重试。',
    recovery: 'retry',
    scope: documentScope,
  },

  'canvas close transaction failed': {
    impact: 'recoverable',
    code:
      'CANVAS_CLOSE_FAILED',
    userMessage:
      '无法关闭画布，请重试。',
    recovery: 'retry',
    scope: documentScope,
  },

  'main window minimize failed': {
    impact: 'feature-degraded',
    code:
      'WINDOW_MINIMIZE_UNAVAILABLE',
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

  'main window maximize failed': {
    impact: 'feature-degraded',
    code:
      'WINDOW_MAXIMIZE_UNAVAILABLE',
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

  'main window drag failed': {
    impact: 'feature-degraded',
    code:
      'WINDOW_DRAG_UNAVAILABLE',
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

  'open developer tools failed': {
    impact: 'feature-degraded',
    code:
      'DEVELOPER_TOOLS_UNAVAILABLE',
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

  'settings load failed': {
    impact: 'feature-degraded',
    code:
      'SETTINGS_LOAD_FAILED',
    userMessage:
      '设置读取失败，当前会话将使用默认设置。',
    recovery:
      'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'settings',
    }),
  },

  'window maximize state query failed': {
    impact: 'feature-degraded',
    code:
      'WINDOW_STATE_QUERY_UNAVAILABLE',
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

  'window resize listener registration failed': {
    impact: 'feature-degraded',
    code:
      'WINDOW_RESIZE_SYNC_UNAVAILABLE',
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

  'main window close listener registration failed': {
    impact: 'feature-degraded',
    code:
      'WINDOW_CLOSE_LISTENER_UNAVAILABLE',
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
} as const satisfies Readonly<
  Record<string, UiFailurePolicy>
>

export type UiFailureName =
  keyof typeof UI_FAILURE_POLICIES

export function reportUiFailure(
  name: UiFailureName,
  context: Readonly<
    Record<string, unknown>
  >,
): void {
  const policy =
    UI_FAILURE_POLICIES[name]

  const input:
    NonTerminalFailureInput = {
      impact: policy.impact,
      code: policy.code,
      userMessage:
        policy.userMessage,
      technicalMessage: name,
      scope:
        policy.scope(context),
      recovery: policy.recovery,
      ...optionalProperty(
        'cause',
        context['cause'],
      ),
      context,
    }

  reportDiagnosticError(name, {
    ...context,
    failureCode: policy.code,
    failureImpact:
      policy.impact,
    failureRecovery:
      policy.recovery,
  })

  failureRuntime.report(input)
}

export function UiFeedbackRegion() {
  const snapshot =
    useSyncExternalStore(
      failureRuntime.subscribe,
      failureRuntime.getSnapshot,
      failureRuntime.getSnapshot,
    )

  useEffect(() => {
    const timers: number[] = []

    for (
      const entry of
      snapshot.failures
    ) {
      if (
        entry.failure.impact ===
        'document-fatal'
      ) {
        continue
      }

      const timeout =
        entry.failure.impact ===
        'feature-degraded'
          ? 9_000
          : 5_500

      timers.push(
        window.setTimeout(() => {
          failureRuntime.dismiss(
            entry.failure.id,
          )
        }, timeout),
      )
    }

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [snapshot.failures])

  const visible =
    snapshot.failures.slice(-3)

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
        const failure =
          entry.failure

        return (
          <div
            className={[
              'pointer-events-auto',
              'flex items-start gap-3',
              'rounded-lg border',
              borderClass(
                failure.impact,
              ),
              'bg-background p-3',
              'text-sm shadow-xl',
            ].join(' ')}
            key={failure.id}
            role="alert"
          >
            <DangerCircle
              aria-hidden="true"
              className={[
                'mt-0.5 size-4',
                'shrink-0',
                iconClass(
                  failure.impact,
                ),
              ].join(' ')}
            />

            <div
              className={[
                'min-w-0 flex-1',
                'grid gap-1',
              ].join(' ')}
            >
              <span className="leading-5">
                {failure.userMessage}
              </span>

              <span className="text-xs text-muted-foreground">
                {impactLabel(
                  failure.impact,
                )}
                {' · '}
                {failure.code}

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
                failureRuntime.dismiss(
                  failure.id,
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

function documentScope(
  context: Readonly<
    Record<string, unknown>
  >,
): FailureScope {
  const sessionId =
    context['sessionId']

  if (
    typeof sessionId === 'string' &&
    sessionId.length > 0
  ) {
    return {
      kind: 'document',
      documentId: sessionId,
    }
  }

  return {
    kind: 'operation',
    operation:
      'document-operation',
  }
}

function impactLabel(
  impact:
    NonTerminalFailureInput['impact'],
): string {
  switch (impact) {
    case 'recoverable':
      return '操作失败'

    case 'feature-degraded':
      return '功能受限'

    case 'document-fatal':
      return '文档已隔离'
  }
}

function borderClass(
  impact: FailureImpact,
): string {
  switch (impact) {
    case 'recoverable':
      return 'border-destructive/30'

    case 'feature-degraded':
      return 'border-warning/40'

    case 'document-fatal':
      return 'border-destructive/60'

    case 'application-fatal':
    case 'native-fatal':
      return 'border-destructive/70'
  }
}

function iconClass(
  impact: FailureImpact,
): string {
  return impact ===
    'feature-degraded'
    ? 'text-warning'
    : 'text-destructive'
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

  await writeText(FILES.uiFeedback, source)
}

async function migrateUiFailureCallSites() {
  for (const relativePath of [FILES.appShell, FILES.workspace]) {
    const file = resolvePath(relativePath)

    let source = await readFile(file, 'utf8')

    source = source.replaceAll('reportUiError as reportError', 'reportUiFailure as reportFailure')

    source = source.replaceAll('reportError(', 'reportFailure(')

    if (source.includes('reportUiError')) {
      throw new Error(relativePath + ' still references reportUiError.')
    }

    await writeFile(file, normalizeText(source), 'utf8')

    console.log(relativePath + ': migrated.')
  }
}

async function unifyFatalImpactType() {
  const file = resolvePath(FILES.fatalRuntime)

  let source = await readFile(file, 'utf8')

  const importLine = "import type { FailureImpact } from '@hybrid-canvas/foundations-kernel'"

  if (!source.includes(importLine)) {
    source = importLine + '\n' + source
  }

  source = source.replace(
    "export type FatalEscalationImpact = 'application-fatal' | 'native-fatal'",
    [
      'export type FatalEscalationImpact =',
      '  Extract<',
      '    FailureImpact,',
      "    'application-fatal' | 'native-fatal'",
      '  >',
    ].join('\n'),
  )

  if (!source.includes('Extract<')) {
    throw new Error('Could not unify FatalEscalationImpact with FailureImpact.')
  }

  await writeFile(file, normalizeText(source), 'utf8')
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

const requiredFiles = [
  'foundations/kernel/src/failure-policy.ts',
  'foundations/kernel/src/failure-policy.test.ts',
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/application/failures/failure-runtime.test.ts',
  'apps/desktop/src/presentation/ui/ui-feedback.tsx',
  'docs/adr/ADR-007-application-failure-severity.md',
]

for (
  const relativePath of
  requiredFiles
) {
  if (
    !existsSync(
      path.join(
        ROOT,
        relativePath,
      ),
    )
  ) {
    failures.push(
      'Missing failure severity artifact: ' +
        relativePath,
    )
  }
}

if (failures.length === 0) {
  const policy = read(
    'foundations/kernel/src/failure-policy.ts',
  )

  const runtime = read(
    'apps/desktop/src/application/failures/failure-runtime.ts',
  )

  const feedback = read(
    'apps/desktop/src/presentation/ui/ui-feedback.tsx',
  )

  const fatalRuntime = read(
    'apps/desktop/src/fatal/fatal-runtime.ts',
  )

  for (const impact of [
    'recoverable',
    'feature-degraded',
    'document-fatal',
    'application-fatal',
    'native-fatal',
  ]) {
    requireText(
      policy,
      "'" + impact + "'",
      'Failure policy is missing impact ' +
        impact +
        '.',
    )
  }

  requireText(
    runtime,
    'degradedFeatures',
    'Failure runtime does not own feature degradation.',
  )

  requireText(
    runtime,
    'quarantinedDocuments',
    'Failure runtime does not own document quarantine.',
  )

  requireText(
    runtime,
    'isTerminalFailureImpact',
    'Non-terminal runtime does not reject terminal failure impact.',
  )

  requireText(
    feedback,
    'UI_FAILURE_POLICIES',
    'UI failures are not centrally classified.',
  )

  requireText(
    feedback,
    'useSyncExternalStore',
    'UI feedback does not consume the failure state machine.',
  )

  forbidText(
    feedback,
    'CustomEvent(',
    'UI failure propagation still uses CustomEvent.',
  )

  forbidText(
    feedback,
    'USER_MESSAGES',
    'Legacy free-form USER_MESSAGES mapping remains.',
  )

  requireText(
    fatalRuntime,
    "FailureImpact",
    'Fatal impact is disconnected from the canonical failure model.',
  )

  scanProductionSources()
}

if (failures.length > 0) {
  console.error(
    [
      'Failure severity architecture checks failed:',
      ...failures.map(
        (failure) =>
          '- ' + failure,
      ),
    ].join('\\n'),
  )

  process.exitCode = 1
} else {
  console.log(
    'Failure severity architecture checks passed.',
  )
}

function scanProductionSources() {
  for (
    const relativePath of
    walk('apps/desktop/src')
  ) {
    if (
      !relativePath.endsWith('.ts') &&
      !relativePath.endsWith('.tsx')
    ) {
      continue
    }

    if (
      relativePath.endsWith(
        '.test.ts',
      ) ||
      relativePath.endsWith(
        '.test.tsx',
      )
    ) {
      continue
    }

    const source = read(
      relativePath,
    )

    if (
      source.includes(
        'reportUiError',
      )
    ) {
      failures.push(
        'Legacy reportUiError remains in ' +
          relativePath +
          '.',
      )
    }

    if (
      source.includes(
        'fatalIncidentController.report(',
      ) &&
      relativePath !==
        'apps/desktop/src/fatal/fatal-runtime.ts'
    ) {
      failures.push(
        'Direct fatal controller report remains in ' +
          relativePath +
          '.',
      )
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

function forbidText(
  source,
  forbidden,
  failure,
) {
  if (source.includes(forbidden)) {
    failures.push(failure)
  }
}
`

  await writeText(FILES.architectureCheck, source)
}

async function writeArchitectureDecision() {
  const source = `# ADR-007: Application failure severity architecture

- Status: Accepted
- Date: 2026-07-24
- Scope: Application, presentation, renderer fatal runtime and native recovery

## Context

Errors were previously divided only into local UI errors and global fatal
incidents. Local UI errors were identified by arbitrary message strings and
delivered through browser CustomEvent instances.

That model could not represent feature degradation or document isolation and
allowed presentation code to infer severity.

## Decision

Hybrid Canvas defines five failure impacts:

1. recoverable — the operation failed but the owning state remains valid;
2. feature-degraded — one optional feature is unavailable;
3. document-fatal — one document cannot safely continue and is quarantined;
4. application-fatal — the renderer cannot safely continue;
5. native-fatal — the native process terminated unexpectedly.

Failure impact, scope and recovery are separate concepts.

The canonical model belongs to foundations/kernel. It contains no React, Tauri
or presentation dependency.

Non-terminal failures are owned by FailureRuntime. Terminal failures are owned
exclusively by the FatalIncidentController.

Presentation consumes structured failure state through an external store.
Browser CustomEvent is not an application state mechanism.

Rust IPC recoverable remains an operation retryability hint. The native layer
must not decide renderer presentation severity.

## Recovery rules

- recoverable: retry, dismiss or none;
- feature-degraded: retry, dismiss, disable-feature or none;
- document-fatal: retry, close-document or none;
- application-fatal: reload, restart, exit or none;
- native-fatal: restart, exit or none.

Invalid impact, scope and recovery combinations are rejected.

## Ownership rules

Feature degradation requires a feature scope.

Document fatal requires a document scope.

Application fatal requires application scope.

Native fatal requires native-process scope.

A dismissed feature notice does not automatically restore that feature.

A dismissed document notice does not remove document quarantine.

## Consequences

The UI no longer guesses severity from an error string.

Repeated failures are deduplicated and counted.

Feature degradation and document quarantine survive notice dismissal until the
owning scope explicitly resolves them.

Global fatal UI remains reserved for application and native terminal failures.
`

  await writeText(FILES.adr, source)
}

async function registerArchitectureCheck() {
  const file = resolvePath(FILES.rootPackage)

  const packageJson = JSON.parse(await readFile(file, 'utf8'))

  const command = 'node tests/architecture/check-failure-severity-architecture.mjs'

  const current = packageJson.scripts?.['test:architecture']

  if (typeof current !== 'string') {
    throw new Error('package.json is missing test:architecture.')
  }

  if (!current.includes(command)) {
    packageJson.scripts['test:architecture'] = current + ' && ' + command

    await writeJson(file, packageJson)
  }
}

async function writeText(relativePath, content) {
  const absolutePath = resolvePath(relativePath)

  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  })

  await writeFile(absolutePath, normalizeText(content), 'utf8')

  console.log(relativePath + ': written.')
}

async function writeJson(absolutePath, value) {
  await writeFile(absolutePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath)
}

main().catch((error) => {
  console.error('')
  console.error('Failure severity architecture refactor failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
