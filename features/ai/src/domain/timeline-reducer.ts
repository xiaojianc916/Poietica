import type { AcpContentBlock, AcpSessionUpdate } from '../contracts/acp-session-contract'
import type { RunEvent, RunId, RunStatus } from '../contracts/run-contract'
import type {
  AgentTextItem,
  AgentThoughtItem,
  TimelineItem,
  TimelineState,
  ToolCallTimelineItem,
} from '../contracts/timeline-contract'

/**
 * The timeline reducer.
 *
 * Pure, total and replayable: the same events in the same order always produce
 * the same state, and replaying a persisted log must reproduce a live run byte
 * for byte. It performs no IO, holds no clock and touches no module state.
 *
 * Tolerances are deliberate, because a transport can misbehave:
 *   - a duplicated seq is discarded;
 *   - a tool_call_update for an unknown id creates a placeholder rather than
 *     dropping the update on the floor.
 */

export function createTimelineState(runId: RunId): TimelineState {
  return {
    runId,
    status: 'idle',
    items: [],
    lastSeq: -1,
    appliedSeqs: new Set<number>(),
  }
}

export function replayRunEvents(runId: RunId, events: readonly RunEvent[]): TimelineState {
  let state = createTimelineState(runId)
  for (const event of events) state = applyRunEvent(state, event)
  return state
}

export function applyRunEvent(state: TimelineState, event: RunEvent): TimelineState {
  if (state.appliedSeqs.has(event.seq)) return state

  const appliedSeqs = new Set(state.appliedSeqs)
  appliedSeqs.add(event.seq)

  const base: TimelineState = {
    ...state,
    appliedSeqs,
    lastSeq: Math.max(state.lastSeq, event.seq),
  }

  switch (event.kind) {
    case 'run_started':
      return { ...base, status: 'running', items: withPrompt(base.items, event) }

    case 'acp_update':
      return applyAcpUpdate(base, event.notification.update, event.seq, event.at)

    case 'permission_requested':
      return {
        ...base,
        status: 'awaiting_permission',
        items: [
          ...sealTail(base.items),
          {
            type: 'permission',
            id: 'permission-' + event.requestId,
            at: event.at,
            requestId: event.requestId,
            title: event.title,
            options: event.options,
          },
        ],
      }

    case 'permission_resolved':
      return {
        ...base,
        status: 'running',
        items: base.items.map((item) =>
          item.type === 'permission' && item.requestId === event.requestId
            ? { ...item, resolution: { optionId: event.optionId, outcome: event.outcome } }
            : item,
        ),
      }

    case 'run_finished':
      return {
        ...base,
        status: finalStatus(event.stopReason),
        items: sealTail(base.items),
      }

    case 'run_failed':
      return {
        ...base,
        status: 'failed',
        items: [
          ...sealTail(base.items),
          { type: 'error', id: 'error-' + String(event.seq), at: event.at, message: event.message },
        ],
      }

    default:
      return base
  }
}

/* -------------------------------------------------------------- */

function applyAcpUpdate(
  state: TimelineState,
  update: AcpSessionUpdate,
  seq: number,
  at: number,
): TimelineState {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return {
        ...state,
        items: [
          ...sealTail(state.items),
          { type: 'user_message', id: 'user-' + String(seq), at, text: textOf(update.content) },
        ],
      }

    case 'agent_message_chunk':
      return {
        ...state,
        items: appendChunk(state.items, 'agent_text', textOf(update.content), seq, at),
      }

    case 'agent_thought_chunk':
      return {
        ...state,
        items: appendChunk(state.items, 'agent_thought', textOf(update.content), seq, at),
      }

    case 'tool_call': {
      const existing = indexOfToolCall(state.items, update.toolCallId)
      const created: ToolCallTimelineItem = {
        type: 'tool_call',
        id: 'tool-' + update.toolCallId,
        at,
        toolCallId: update.toolCallId,
        title: update.title,
        kind: update.kind,
        status: update.status,
        content: update.content ?? [],
        locations: update.locations ?? [],
        rawInput: update.rawInput,
        startedAt: at,
      }
      if (existing < 0) return { ...state, items: [...sealTail(state.items), created] }
      return { ...state, items: replaceAt(state.items, existing, created) }
    }

    case 'tool_call_update': {
      const index = indexOfToolCall(state.items, update.toolCallId)
      if (index < 0) {
        const placeholder: ToolCallTimelineItem = {
          type: 'tool_call',
          id: 'tool-' + update.toolCallId,
          at,
          toolCallId: update.toolCallId,
          title: update.title ?? update.toolCallId,
          kind: update.kind ?? 'other',
          status: update.status ?? 'in_progress',
          content: update.content ?? [],
          locations: update.locations ?? [],
          rawOutput: update.rawOutput,
          startedAt: at,
        }
        return { ...state, items: [...sealTail(state.items), placeholder] }
      }

      const current = state.items[index]
      if (!current || current.type !== 'tool_call') return state

      const status = update.status ?? current.status
      /* A call that is still running has no end time, which is not the same as
         having one that is undefined. The distinction is the whole point of
         exactOptionalPropertyTypes, so the property is omitted rather than set
         to nothing. An end, once recorded, is never moved. */
      const endedAt = isTerminal(status) ? (current.endedAt ?? at) : current.endedAt
      const merged: ToolCallTimelineItem = {
        ...current,
        title: update.title ?? current.title,
        kind: update.kind ?? current.kind,
        status,
        content: update.content ?? current.content,
        locations: update.locations ?? current.locations,
        rawOutput: update.rawOutput ?? current.rawOutput,
        ...(endedAt === undefined ? {} : { endedAt }),
      }
      return { ...state, items: replaceAt(state.items, index, merged) }
    }

    case 'plan': {
      /* The protocol replaces the whole plan; keep exactly one plan entry. */
      const index = state.items.findIndex((item) => item.type === 'plan')
      const plan = { type: 'plan', id: 'plan', at, entries: update.entries } as const
      if (index < 0) return { ...state, items: [...sealTail(state.items), plan] }
      return { ...state, items: replaceAt(state.items, index, plan) }
    }

    case 'available_commands_update':
      /* A session capability, not a turn. The command list belongs to the
         composer that offers the commands, not to the transcript of what
         happened, so it produces no item here. This case is written out rather
         than left to the default so that ignoring it stays a decision. */
      return state

    default:
      return state
  }
}

/**
 * Opens the timeline with what the user said.
 *
 * The prompt is read out of the run log rather than remembered by the
 * interface, so a replayed run and a live run show the same conversation. A
 * recording made before the prompt was logged carries none, and adds nothing.
 */
function withPrompt(
  items: readonly TimelineItem[],
  event: { readonly seq: number; readonly at: number; readonly prompt?: string },
): readonly TimelineItem[] {
  if (event.prompt === undefined || event.prompt.length === 0) return items
  return [
    ...items,
    { type: 'user_message', id: 'user-' + String(event.seq), at: event.at, text: event.prompt },
  ]
}

function appendChunk(
  items: readonly TimelineItem[],
  type: 'agent_text' | 'agent_thought',
  chunk: string,
  seq: number,
  at: number,
): readonly TimelineItem[] {
  const tail = items.at(-1)
  if (tail && tail.type === type && !tail.sealed) {
    const grown: AgentTextItem | AgentThoughtItem = { ...tail, text: tail.text + chunk }
    return replaceAt(items, items.length - 1, grown)
  }
  const prefix = type === 'agent_text' ? 'text-' : 'thought-'
  return [
    ...sealTail(items),
    { type, id: prefix + String(seq), at, text: chunk, sealed: false } as
      | AgentTextItem
      | AgentThoughtItem,
  ]
}

function sealTail(items: readonly TimelineItem[]): readonly TimelineItem[] {
  const tail = items.at(-1)
  if (!tail) return items
  if (tail.type !== 'agent_text' && tail.type !== 'agent_thought') return items
  if (tail.sealed) return items
  return replaceAt(items, items.length - 1, { ...tail, sealed: true })
}

function replaceAt(
  items: readonly TimelineItem[],
  index: number,
  item: TimelineItem,
): readonly TimelineItem[] {
  const next = items.slice()
  next.splice(index, 1, item)
  return next
}

function indexOfToolCall(items: readonly TimelineItem[], toolCallId: string): number {
  return items.findIndex((item) => item.type === 'tool_call' && item.toolCallId === toolCallId)
}

function isTerminal(status: ToolCallTimelineItem['status']): boolean {
  return status === 'completed' || status === 'failed'
}

function textOf(content: AcpContentBlock): string {
  return content.type === 'text' ? content.text : ''
}

function finalStatus(stopReason: string): RunStatus {
  if (stopReason === 'cancelled') return 'cancelled'
  if (stopReason === 'refusal') return 'failed'
  return 'completed'
}
