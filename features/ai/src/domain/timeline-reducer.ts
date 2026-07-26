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
 * The state is a conversation, not a run. A turn is a segment appended to it:
 * appendUserMessage opens the segment the moment the user commits, and the
 * frames of that turn fill it in. Nothing is ever cleared, because a transcript
 * that forgets the previous turn is not a transcript.
 *
 * Sequence numbers restart at one for every run, so a seq identifies a frame
 * only inside its own segment, and entry identities are namespaced by segment.
 * Without that, a second turn writes over the first one: the agent is free to
 * reuse a tool call id, and the deduplicator would discard every frame of it.
 *
 * Tolerances are deliberate, because a transport can misbehave:
 *   - a duplicated seq inside a segment is discarded;
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
    runIndex: 0,
  }
}

export function replayRunEvents(runId: RunId, events: readonly RunEvent[]): TimelineState {
  let state = createTimelineState(runId)
  for (const event of events) state = applyRunEvent(state, event)
  return state
}

/**
 * Opens a turn with what the user said.
 *
 * The message is a local fact: they typed it, they committed it, and no process,
 * protocol or log has to confirm it before it can be read back. A transport
 * failure must be able to take the answer away without taking the question with
 * it, which is why nothing here waits for a frame.
 *
 * Opening a segment also resets the sequence window, because the run about to
 * start numbers its own frames from one.
 */
export function appendUserMessage(state: TimelineState, text: string, at: number): TimelineState {
  const said = text.trim()
  if (said.length === 0) return state

  const opened: TimelineState = {
    ...state,
    status: 'running',
    lastSeq: -1,
    appliedSeqs: new Set<number>(),
    runIndex: state.runIndex + 1,
  }

  return {
    ...opened,
    items: [
      ...sealTail(state.items),
      { type: 'user_message', id: namespace(opened) + 'said', at, text: said },
    ],
  }
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
      return { ...base, status: 'running', items: withPrompt(base, event) }

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
            id: namespace(base) + 'permission-' + event.requestId,
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

    case 'run_finished': {
      /* A turn can end on the agent terms and still be a failure: a rejected
         provider request is reported by the agent itself, outside the
         protocol, and the stop reason stays ordinary. When it left such an
         account, that account is the entry, and our own wording never
         appears at all. */
      const sealed = sealTail(base.items)
      const said = event.diagnostics?.trim() ?? ''
      const status = finalStatus(event.stopReason)

      if (said.length === 0) return { ...base, status, items: sealed }

      return {
        ...base,
        status,
        items: [
          ...sealed,
          {
            type: 'error',
            id: namespace(base) + 'agent-' + String(event.seq),
            at: event.at,
            message: said,
          },
        ],
      }
    }

    case 'run_failed':
      return {
        ...base,
        status: 'failed',
        items: [
          ...sealTail(base.items),
          {
            type: 'error',
            id: namespace(base) + 'error-' + String(event.seq),
            at: event.at,
            message: preferAgent(event.message, event.diagnostics),
          },
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
  const scope = namespace(state)

  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return {
        ...state,
        items: [
          ...sealTail(state.items),
          {
            type: 'user_message',
            id: scope + 'user-' + String(seq),
            at,
            text: textOf(update.content),
          },
        ],
      }

    case 'agent_message_chunk':
      return {
        ...state,
        items: appendChunk(state.items, 'agent_text', textOf(update.content), scope, seq, at),
      }

    case 'agent_thought_chunk':
      return {
        ...state,
        items: appendChunk(state.items, 'agent_thought', textOf(update.content), scope, seq, at),
      }

    case 'tool_call': {
      const id = scope + 'tool-' + update.toolCallId
      const existing = indexOfId(state.items, id)
      const created: ToolCallTimelineItem = {
        type: 'tool_call',
        id,
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
      const id = scope + 'tool-' + update.toolCallId
      const index = indexOfId(state.items, id)
      if (index < 0) {
        const placeholder: ToolCallTimelineItem = {
          type: 'tool_call',
          id,
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
      /* The protocol replaces the whole plan; keep exactly one plan entry per
         turn, so a later turn cannot rewrite an earlier one. */
      const id = scope + 'plan'
      const index = indexOfId(state.items, id)
      const plan = { type: 'plan', id, at, entries: update.entries } as const
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
 * The identity prefix of the turn currently being written.
 */
function namespace(state: TimelineState): string {
  return 'r' + String(state.runIndex) + '-'
}

/**
 * Reconciles the recorded prompt with the one already on screen.
 *
 * A live surface shows the question the instant it is asked; a replayed run has
 * only the recorded frame to show it with. Both are the same question, so they
 * converge on one entry instead of each adding their own.
 */
function withPrompt(
  state: TimelineState,
  event: { readonly seq: number; readonly at: number; readonly prompt?: string },
): readonly TimelineItem[] {
  const prompt = event.prompt
  if (prompt === undefined || prompt.length === 0) return state.items

  const tail = state.items.at(-1)
  if (tail && tail.type === 'user_message' && tail.text === prompt) return state.items

  return [
    ...sealTail(state.items),
    {
      type: 'user_message',
      id: namespace(state) + 'said-' + String(event.seq),
      at: event.at,
      text: prompt,
    },
  ]
}

function appendChunk(
  items: readonly TimelineItem[],
  type: 'agent_text' | 'agent_thought',
  chunk: string,
  scope: string,
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
    { type, id: scope + prefix + String(seq), at, text: chunk, sealed: false } as
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

function indexOfId(items: readonly TimelineItem[], id: string): number {
  return items.findIndex((item) => item.id === id)
}

function isTerminal(status: ToolCallTimelineItem['status']): boolean {
  return status === 'completed' || status === 'failed'
}

function textOf(content: AcpContentBlock): string {
  return content.type === 'text' ? content.text : ''
}

/**
 * The account the agent gave, or ours if it gave none.
 *
 * Ours is a description of a silence: it exists so that a turn nobody can
 * explain is still visible. The moment the agent explains itself, ours is not
 * context, it is noise, so it is not shown alongside — it is not shown.
 */
function preferAgent(message: string, diagnostics?: string): string {
  const said = diagnostics?.trim() ?? ''
  return said.length === 0 ? message : said
}

function finalStatus(stopReason: string): RunStatus {
  if (stopReason === 'cancelled') return 'cancelled'
  if (stopReason === 'refusal') return 'failed'
  return 'completed'
}
