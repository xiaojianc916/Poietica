import type {
  AcpSessionId,
  AcpSessionNotification,
  AcpStopReason,
  AcpToolCallContent,
  AcpToolCallId,
  AcpToolCallLocation,
  AcpToolCallStatus,
  AcpToolKind,
} from './acp-session-contract'

export type ThreadId = string

export type RunStatus =
  | 'idle'
  | 'running'
  | 'awaiting_permission'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface PermissionOption {
  readonly optionId: string
  readonly name: string
  readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

/**
 * The operation consent is being asked for.
 *
 * The agent sends the whole tool call alongside the request, in the same flat
 * shape a tool_call_update carries, because a prompt naming only the verb is
 * not a question anyone can answer: Write, to which file, replacing what.
 *
 * Optional because a run recorded before this field was carried across still
 * has to replay, not because the agent may omit it.
 */
export interface PermissionToolCall {
  readonly toolCallId: AcpToolCallId
  readonly title?: string
  readonly kind?: AcpToolKind
  readonly status?: AcpToolCallStatus
  readonly content?: readonly AcpToolCallContent[]
  readonly locations?: readonly AcpToolCallLocation[]
  readonly rawInput?: unknown
}

/**
 * The append-only run event log.
 *
 * 'acp_update' carries the protocol notification verbatim. Everything else is a
 * client-side fact about the run that the protocol does not model. Every event
 * carries a monotonic seq so replay is deterministic and duplicates are cheap
 * to discard.
 */
export type RunEvent =
  | {
      readonly kind: 'run_started'
      readonly seq: number
      readonly at: number
      readonly sessionId: AcpSessionId
      /**
       * 人说的那句话，按记录时的原文。
       *
       * 今天的生产者必发：原生侧的 RunFrame::RunStarted 把它声明为 String 而
       * 不是 Option（frame.rs）。可选说的不是它，是日志 —— 这一格加进来之前
       * 录下的帧没有它，而那些录制就在本仓库里：agent/timeline 下三份录制回放
       * 时的 run_started 都缺这一格。
       *
       * 日志是历史，历史改不了。同一件事这个文件里已有先例，见下面
       * PermissionToolCall 上的那句话。
       */
      readonly prompt?: string | undefined
    }
  | {
      readonly kind: 'acp_update'
      readonly seq: number
      readonly at: number
      readonly notification: AcpSessionNotification
    }
  | {
      readonly kind: 'permission_requested'
      readonly seq: number
      readonly at: number
      readonly requestId: string
      readonly toolCallId?: string
      readonly title: string
      readonly toolCall?: PermissionToolCall
      readonly options: readonly PermissionOption[]
    }
  | {
      readonly kind: 'permission_resolved'
      readonly seq: number
      readonly at: number
      readonly requestId: string
      readonly optionId: string
      readonly outcome: 'selected' | 'cancelled'
    }
  | {
      readonly kind: 'run_finished'
      readonly seq: number
      readonly at: number
      readonly stopReason: AcpStopReason
      /**
       * What the agent said for itself while the protocol said nothing.
       *
       * An agent may report a failure of its own and still end the turn
       * normally, so a finished turn is not automatically a successful one.
       * Present only when the turn produced no update of any kind.
       */
      readonly diagnostics?: string
    }
  | {
      readonly kind: 'run_failed'
      readonly seq: number
      readonly at: number
      readonly message: string
      /** What the agent said for itself, which is preferred to the above. */
      readonly diagnostics?: string
    }
