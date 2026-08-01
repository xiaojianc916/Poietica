import type { FailureImpact, FailureRecovery, FailureScope } from '@poietica/core'
import { optionalProperty } from '@poietica/core'
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
  'AGENT_CAPABILITIES_UNREADABLE',
  'UPDATE_DOWNLOAD_FAILED',
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
   * 没能读到 agent 现在给得出哪些选项：模型、模式、推理档位，同一次往返里一起来。
   *
   * 此前这一路只写一条日志：选择器空着，屏幕上没有任何解释 —— 而 agent 的 stderr
   * 恰恰说得出是哪一行配置坏了。一次往返失手不是功能没了，重进这一格就会再问一次，
   * 所以 recovery 是 retry。
   */
  /*
   * 这一条还盖着一个它不该盖的情形：全新安装。
   *
   * 上面那段推理对"偶发失败"成立，对"从来没配过"完全不成立 —— 新电脑上
   * agent CLI 没装、密钥没填，重试一万次结果一样，缺的不是运气，是一个还不
   * 存在的前提。三种处境（没装 / 没配 / 真的失手）现在共用同一个错误码和
   * 同一句话，而前两种根本不是错误，是"还没开始"。
   *
   * 分开它们要新增一个首次运行状态，不是改一句文案能做到的事。在那之前，
   * 这句话至少要把人指向唯一能解决问题的地方 —— 设置页会说出真实的原因：
   * 程序找不到、还是密钥没填。让人对着一句"没能读到"按重试，是最坏的一种。
   */
  AGENT_CAPABILITIES_UNREADABLE: {
    impact: 'recoverable',
    userMessage: '没能读到可用的模型。到「设置 → 模型」看看 agent 装好了没有、密钥填了没有。',

    recovery: 'retry',

    scope: operationScope('read-capabilities'),
  },
  /*
   * 更新没能下下来。
   *
   * 不是"功能受限"：应用一切照旧，装着的这一版一个字节都没被改动，失手的只是
   * 一次可以随时再来的下载。所以 impact 是 recoverable、recovery 是 retry，
   * 作用域是一次操作而不是一个功能——feature 作用域会把控件变灰，而这里没有
   * 任何控件需要变灰。
   *
   * 具体原因（网络、签名、更新源）不进这句话：它们在原生日志里，而脱敏之后
   * 能说出口的那句是"插件操作失败"，对着用户说等于什么都没说。
   */
  UPDATE_DOWNLOAD_FAILED: {
    impact: 'recoverable',
    userMessage: '更新没能下载完成，当前版本没有被改动。',

    recovery: 'retry',

    scope: operationScope('download-update'),
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
