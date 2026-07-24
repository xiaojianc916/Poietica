import type {
  FailureImpact,
  FailureRecovery,
  FailureScope,
} from '@hybrid-canvas/foundations-kernel'
import { failureCoordinator, type FailureIncident, type FailureSignal } from './failure-coordinator'

export const DEGRADABLE_FEATURE_IDS = [
  'settings',
  'developer-tools',
  'window-controls',
  'window-dragging',
  'window-state-sync',
  'window-close-coordination',
] as const

export type DegradableFeatureId = (typeof DEGRADABLE_FEATURE_IDS)[number]

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

export type ApplicationFailureCode = (typeof APPLICATION_FAILURE_CODES)[number]

export type FailureReportContext = Readonly<Record<string, unknown>>

interface ApplicationFailurePolicy {
  readonly impact: FailureImpact

  readonly userMessage: string

  readonly recovery: FailureRecovery

  readonly scope: (context: FailureReportContext) => FailureScope
}

const APPLICATION_FAILURE_POLICIES = {
  CANVAS_CREATE_FAILED: {
    impact: 'recoverable',
    userMessage: '无法新建画布，请重试。',

    recovery: 'retry',

    scope: () => ({
      kind: 'operation',
      operation: 'create-canvas',
    }),
  },

  CANVAS_OPEN_FAILED: {
    impact: 'recoverable',
    userMessage: '无法打开画布，请检查文件后重试。',

    recovery: 'retry',

    scope: () => ({
      kind: 'operation',
      operation: 'open-canvas',
    }),
  },

  CANVAS_SAVE_FAILED: {
    impact: 'recoverable',
    userMessage: '画布保存失败，请重试。',

    recovery: 'retry',
    scope: documentOrOperationScope('save-canvas'),
  },

  CANVAS_CLOSE_FAILED: {
    impact: 'recoverable',
    userMessage: '无法关闭画布，请重试。',

    recovery: 'retry',
    scope: documentOrOperationScope('close-canvas'),
  },

  WINDOW_MINIMIZE_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口最小化暂时不可用。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'window-controls',
    }),
  },

  WINDOW_MAXIMIZE_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口最大化或还原暂时不可用。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'window-controls',
    }),
  },

  WINDOW_DRAG_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口拖动暂时不可用。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'window-dragging',
    }),
  },

  DEVELOPER_TOOLS_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '开发者工具暂时不可用。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'developer-tools',
    }),
  },

  SETTINGS_LOAD_FAILED: {
    impact: 'feature-degraded',
    userMessage: '设置读取失败，当前会话将使用默认设置。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'settings',
    }),
  },

  WINDOW_STATE_QUERY_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '无法同步窗口状态。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'window-state-sync',
    }),
  },

  WINDOW_RESIZE_SYNC_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口尺寸状态同步暂时不可用。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'window-state-sync',
    }),
  },

  WINDOW_CLOSE_LISTENER_UNAVAILABLE: {
    impact: 'feature-degraded',
    userMessage: '窗口关闭协调暂时不可用。',

    recovery: 'disable-feature',

    scope: () => ({
      kind: 'feature',
      featureId: 'window-close-coordination',
    }),
  },

  DOCUMENT_EDITOR_SESSION_FATAL: {
    impact: 'document-fatal',
    userMessage: '当前画布遇到严重错误，已被隔离。其他画布仍可继续使用。',

    recovery: 'close-document',

    scope: requireDocumentScope,
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

function documentOrOperationScope(
  operation: string,
): (context: FailureReportContext) => FailureScope {
  return (context) => {
    const documentId = readDocumentId(context)

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

function requireDocumentScope(context: FailureReportContext): FailureScope {
  const documentId = readDocumentId(context)

  if (!documentId) {
    throw new Error('DOCUMENT_EDITOR_SESSION_FATAL requires sessionId.')
  }

  return {
    kind: 'document',
    documentId,
  }
}

function readDocumentId(context: FailureReportContext): string | undefined {
  const sessionId = context['sessionId']

  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined
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
