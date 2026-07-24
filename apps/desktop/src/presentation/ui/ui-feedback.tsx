import type {
  FailureImpact,
  FailureRecovery,
  FailureScope,
} from '@hybrid-canvas/foundations-kernel'
import { error as reportDiagnosticError } from '@hybrid-canvas/foundations-observability'
import { DangerCircle, X } from '@mynaui/icons-react'
import { useEffect, useSyncExternalStore } from 'react'
import {
  failureRuntime,
  type NonTerminalFailureInput,
} from '../../application/failures/failure-runtime'

interface UiFailurePolicy {
  readonly impact: NonTerminalFailureInput['impact']

  readonly code: string
  readonly userMessage: string
  readonly recovery: FailureRecovery

  readonly scope: (context: Readonly<Record<string, unknown>>) => FailureScope
}

const UI_FAILURE_POLICIES = {
  'canvas create failed': {
    impact: 'recoverable',
    code: 'CANVAS_CREATE_FAILED',
    userMessage: '无法新建画布，请重试。',
    recovery: 'retry',
    scope: () => ({
      kind: 'operation',
      operation: 'create-canvas',
    }),
  },

  'canvas open failed': {
    impact: 'recoverable',
    code: 'CANVAS_OPEN_FAILED',
    userMessage: '无法打开画布，请检查文件后重试。',
    recovery: 'retry',
    scope: () => ({
      kind: 'operation',
      operation: 'open-canvas',
    }),
  },

  'canvas save failed': {
    impact: 'recoverable',
    code: 'CANVAS_SAVE_FAILED',
    userMessage: '画布保存失败，请重试。',
    recovery: 'retry',
    scope: documentScope,
  },

  'canvas close transaction failed': {
    impact: 'recoverable',
    code: 'CANVAS_CLOSE_FAILED',
    userMessage: '无法关闭画布，请重试。',
    recovery: 'retry',
    scope: documentScope,
  },

  'main window minimize failed': {
    impact: 'feature-degraded',
    code: 'WINDOW_MINIMIZE_UNAVAILABLE',
    userMessage: '窗口最小化暂时不可用。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'window-controls',
    }),
  },

  'main window maximize failed': {
    impact: 'feature-degraded',
    code: 'WINDOW_MAXIMIZE_UNAVAILABLE',
    userMessage: '窗口最大化或还原暂时不可用。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'window-controls',
    }),
  },

  'main window drag failed': {
    impact: 'feature-degraded',
    code: 'WINDOW_DRAG_UNAVAILABLE',
    userMessage: '窗口拖动暂时不可用。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'window-dragging',
    }),
  },

  'open developer tools failed': {
    impact: 'feature-degraded',
    code: 'DEVELOPER_TOOLS_UNAVAILABLE',
    userMessage: '开发者工具暂时不可用。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'developer-tools',
    }),
  },

  'settings load failed': {
    impact: 'feature-degraded',
    code: 'SETTINGS_LOAD_FAILED',
    userMessage: '设置读取失败，当前会话将使用默认设置。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'settings',
    }),
  },

  'window maximize state query failed': {
    impact: 'feature-degraded',
    code: 'WINDOW_STATE_QUERY_UNAVAILABLE',
    userMessage: '无法同步窗口状态。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'window-state-sync',
    }),
  },

  'window resize listener registration failed': {
    impact: 'feature-degraded',
    code: 'WINDOW_RESIZE_SYNC_UNAVAILABLE',
    userMessage: '窗口尺寸状态同步暂时不可用。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'window-state-sync',
    }),
  },

  'main window close listener registration failed': {
    impact: 'feature-degraded',
    code: 'WINDOW_CLOSE_LISTENER_UNAVAILABLE',
    userMessage: '窗口关闭协调暂时不可用。',
    recovery: 'disable-feature',
    scope: () => ({
      kind: 'feature',
      featureId: 'window-close-coordination',
    }),
  },
} as const satisfies Readonly<Record<string, UiFailurePolicy>>

export type UiFailureName = keyof typeof UI_FAILURE_POLICIES

export function reportUiFailure(
  name: UiFailureName,
  context: Readonly<Record<string, unknown>>,
): void {
  const policy = UI_FAILURE_POLICIES[name]

  const input: NonTerminalFailureInput = {
    impact: policy.impact,
    code: policy.code,
    userMessage: policy.userMessage,
    technicalMessage: name,
    scope: policy.scope(context),
    recovery: policy.recovery,
    ...optionalProperty('cause', context['cause']),
    context,
  }

  reportDiagnosticError(name, {
    ...context,
    failureCode: policy.code,
    failureImpact: policy.impact,
    failureRecovery: policy.recovery,
  })

  failureRuntime.report(input)
}

export function UiFeedbackRegion() {
  const snapshot = useSyncExternalStore(
    failureRuntime.subscribe,
    failureRuntime.getSnapshot,
    failureRuntime.getSnapshot,
  )

  useEffect(() => {
    const timers: number[] = []

    for (const entry of snapshot.failures) {
      if (entry.failure.impact === 'document-fatal') {
        continue
      }

      const timeout = entry.failure.impact === 'feature-degraded' ? 9_000 : 5_500

      timers.push(
        window.setTimeout(() => {
          failureRuntime.dismiss(entry.failure.id)
        }, timeout),
      )
    }

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [snapshot.failures])

  const visible = snapshot.failures
    .filter((entry) => entry.failure.impact !== 'document-fatal')
    .slice(-3)

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
        const failure = entry.failure

        return (
          <div
            className={[
              'pointer-events-auto',
              'flex items-start gap-3',
              'rounded-lg border',
              borderClass(failure.impact),
              'bg-background p-3',
              'text-sm shadow-xl',
            ].join(' ')}
            key={failure.id}
            role="alert"
          >
            <DangerCircle
              aria-hidden="true"
              className={['mt-0.5 size-4', 'shrink-0', iconClass(failure.impact)].join(' ')}
            />

            <div className={['min-w-0 flex-1', 'grid gap-1'].join(' ')}>
              <span className="leading-5">{failure.userMessage}</span>

              <span className="text-xs text-muted-foreground">
                {impactLabel(failure.impact)}
                {' · '}
                {failure.code}

                {entry.occurrences > 1 ? ' · ' + String(entry.occurrences) + ' 次' : ''}
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
                failureRuntime.dismiss(failure.id)
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function documentScope(context: Readonly<Record<string, unknown>>): FailureScope {
  const sessionId = context['sessionId']

  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return {
      kind: 'document',
      documentId: sessionId,
    }
  }

  return {
    kind: 'operation',
    operation: 'document-operation',
  }
}

function impactLabel(impact: FailureImpact): string {
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

function borderClass(impact: FailureImpact): string {
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

function iconClass(impact: FailureImpact): string {
  return impact === 'feature-degraded' ? 'text-warning' : 'text-destructive'
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
