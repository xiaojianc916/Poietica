import type { FailureImpact, FailureRecovery, FailureScope } from '@poietica/foundations-kernel'
import { type FailureIncident, type FailureSignal, failureCoordinator } from './failure-coordinator'

export const APPLICATION_FAILURE_CODES = [
  'WINDOW_MINIMIZE_UNAVAILABLE',
  'WINDOW_MAXIMIZE_UNAVAILABLE',
  'WINDOW_DRAG_UNAVAILABLE',
  'DEVELOPER_TOOLS_UNAVAILABLE',
  'SETTINGS_LOAD_FAILED',
  'WINDOW_STATE_QUERY_UNAVAILABLE',
  'WINDOW_RESIZE_SYNC_UNAVAILABLE',
  'WINDOW_CLOSE_LISTENER_UNAVAILABLE',
  'AGENT_DEFAULT_MODEL_SAVE_FAILED',
  'AGENT_MODELS_UNREADABLE',
] as const

export type ApplicationFailureCode = (typeof APPLICATION_FAILURE_CODES)[number]

/**
 * The features this application knows how to lose.
 *
 * A degraded feature is a promise withdrawn: something the interface offered
 * a moment ago and cannot offer now. Listing them here means the set is
 * reviewable in one place, and that a policy cannot disable a feature nobody
 * ever declared — a typo would be a type error rather than a control that
 * silently never comes back.
 */
export const DEGRADABLE_FEATURE_IDS = [
  'developer-tools',
  'settings',
  'window-close-coordination',
  'window-controls',
  'window-dragging',
  'window-state-sync',
] as const

export type DegradableFeatureId = (typeof DEGRADABLE_FEATURE_IDS)[number]

export type FailureReportContext = Readonly<Record<string, unknown>>

interface ApplicationFailurePolicy {
  readonly impact: FailureImpact

  readonly userMessage: string

  readonly recovery: FailureRecovery

  readonly scope: (context: FailureReportContext) => FailureScope
}

export const APPLICATION_FAILURE_POLICIES = {
  WINDOW_MINIMIZE_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口最小化暂时不可用。',

    recovery: 'disable-feature',

    scope: featureScope('window-controls'),
  },

  WINDOW_MAXIMIZE_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口最大化或还原暂时不可用。',

    recovery: 'disable-feature',

    scope: featureScope('window-controls'),
  },

  WINDOW_DRAG_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口拖动暂时不可用。',

    recovery: 'disable-feature',

    scope: featureScope('window-dragging'),
  },

  DEVELOPER_TOOLS_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '开发者工具暂时不可用。',

    recovery: 'disable-feature',

    scope: featureScope('developer-tools'),
  },

  SETTINGS_LOAD_FAILED: {
    impact: 'feature-degraded',
    userMessage: '设置读取失败，当前会话将使用默认设置。',

    recovery: 'disable-feature',

    scope: featureScope('settings'),
  },

  WINDOW_STATE_QUERY_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '无法同步窗口状态。',

    recovery: 'disable-feature',

    scope: featureScope('window-state-sync'),
  },

  WINDOW_RESIZE_SYNC_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口尺寸状态同步暂时不可用。',

    recovery: 'disable-feature',

    scope: featureScope('window-state-sync'),
  },

  WINDOW_CLOSE_LISTENER_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口关闭协调暂时不可用。',

    recovery: 'disable-feature',

    scope: featureScope('window-close-coordination'),
  },

  /*
   * 模型已经换了，只是没能记住。
   *
   * 所以它不是"功能受限"：选择器照常能用，这一条会话也确实在用新模型，失手的
   * 只是"下次开会话从哪个起步"。人重选一次就好，因此 recovery 是 retry。
   */
  AGENT_DEFAULT_MODEL_SAVE_FAILED: {
    impact: 'recoverable',
    userMessage: '已经换到这个模型，但没能把它记成默认。',

    recovery: 'retry',

    scope: operationScope('save-default-model'),
  },

  /*
   * 没能读到 agent 配了哪些模型。
   *
   * 此前这一路只写一条日志：选择器空着，屏幕上没有任何解释 —— 而 agent 的 stderr
   * 恰恰说得出是哪一行配置坏了。一次子进程往返失手不是功能没了，重进这一格就会
   * 再问一次，所以 recovery 是 retry。
   */
  AGENT_MODELS_UNREADABLE: {
    impact: 'recoverable',
    userMessage: '没能读到可用的模型清单。',

    recovery: 'retry',

    scope: operationScope('read-models'),
  },
} as const satisfies Readonly<Record<ApplicationFailureCode, ApplicationFailurePolicy>>

export function reportFailure(
  code: ApplicationFailureCode,

  context: FailureReportContext,
): FailureIncident {
  const policy = APPLICATION_FAILURE_POLICIES[code]

  const cause = context['cause']

  const componentStack = readOptionalString(context, 'componentStack')

  const source = readOptionalString(context, 'source')

  const line = readOptionalNumber(context, 'line')

  const column = readOptionalNumber(context, 'column')

  const signal: FailureSignal = {
    impact: policy.impact,
    code,
    userMessage: policy.userMessage,

    scope: policy.scope(context),

    recovery: policy.recovery,

    ...optionalProperty('cause', cause),

    context: removeCause(context),

    diagnostic: {
      ...optionalProperty('componentStack', componentStack),

      ...optionalProperty('source', source),

      ...optionalProperty('line', line),

      ...optionalProperty('column', column),
    },
  }

  return failureCoordinator.report(signal)
}

function featureScope(
  featureId: DegradableFeatureId,
): (context: FailureReportContext) => FailureScope {
  return (_context) => ({
    kind: 'feature',
    featureId,
  })
}

/*
 * 一次操作失手，不是一个功能没了。
 *
 * 可恢复的失败不许挂 application / native-process 作用域（见 kernel 的
 * validateFailurePolicy），而 feature 作用域会把它算进"降级的功能"里、让控件
 * 变灰 —— 那不是这里要的：选择器照常能用。
 */
function operationScope(operation: string): (context: FailureReportContext) => FailureScope {
  return (_context) => ({
    kind: 'operation',
    operation,
  })
}

function removeCause(context: FailureReportContext): Readonly<Record<string, unknown>> {
  const entries = Object.entries(context).filter(([key]) => key !== 'cause')

  return Object.fromEntries(entries)
}

function readOptionalString(
  context: FailureReportContext,

  key: string,
): string | undefined {
  const value = context[key]

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readOptionalNumber(
  context: FailureReportContext,

  key: string,
): number | undefined {
  const value = context[key]

  return typeof value === 'number' ? value : undefined
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
