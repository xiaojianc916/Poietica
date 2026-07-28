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
export type RunId = string

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
       * What the user asked, as it was recorded.
       *
       * Optional because a run recorded before this field existed carries no
       * prompt, and a run replayed from that log must still be readable.
       */
      readonly prompt?: string
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
