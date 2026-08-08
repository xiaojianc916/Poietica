import { asRunEvents, toolTurn } from '@poietica/agent-contract/recordings'
import { describe, expect, it } from 'vitest'
import type { AgentTextItem, ToolCallTimelineItem } from '../timeline-contract'
import { replayRunEvents } from '../timeline-reducer'

/**
 * The reducer, driven by a turn a real agent really took.
 *
 * The hand-written reducer tests describe what a tool call is supposed to look
 * like. This one takes what one looked like: a hundred and twenty-one frames,
 * one announcement, nine updates to it, and a hundred and four thought chunks
 * that have to collapse into something a person can read.
 *
 * Nothing here is written down from a particular run. Every expected value is
 * computed from the recording, so re-recording against another agent leaves
 * the test meaningful, and the only way to break it is for the projection to
 * lose or invent something.
 */

const events = asRunEvents(toolTurn)

const state = replayRunEvents(events)

const toolUpdates = events.flatMap((event) => {
  if (event.kind !== 'acp_update') {
    return []
  }

  const update = event.notification.update

  return update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update'
    ? [update]
    : []
})

const toolItems = state.items.filter(
  (item): item is ToolCallTimelineItem => item.type === 'tool_call',
)

describe('a recorded tool turn', () => {
  it('was recorded for the tool call it contains', () => {
    /* Guards the fixture, not the reducer: a recording regenerated from a turn
       that used no tools would make every assertion below vacuous. */
    expect(toolUpdates.some((update) => update.sessionUpdate === 'tool_call')).toBe(true)
  })

  it('replays every recorded frame, in order', () => {
    expect(events).toHaveLength(toolTurn.length)
    expect(state.lastSeq).toBe(toolTurn.length)
  })

  it('keeps one entry per tool call, however many updates arrive', () => {
    const announced = new Set(toolUpdates.map((update) => update.toolCallId))

    expect(toolItems).toHaveLength(announced.size)
    expect(new Set(toolItems.map((item) => item.toolCallId))).toStrictEqual(announced)
  })

  it('ends each tool call where its last update left it', () => {
    const expected = new Map<string, ToolCallTimelineItem['status']>()

    for (const update of toolUpdates) {
      /* 可选，而且 tool_call_update 允许显式 null；都表示这一帧没报状态。 */
      const status = update.status ?? undefined

      if (status !== undefined) {
        expected.set(update.toolCallId, status)
      }
    }

    for (const item of toolItems) {
      expect(item.status).toBe(expected.get(item.toolCallId))

      /* A call that finished has an end; one still running must not have been
         given one. */
      const finished = item.status === 'completed' || item.status === 'failed'

      expect(item.endedAt !== undefined).toBe(finished)
    }
  })

  it('collapses streamed chunks without losing a character', () => {
    const spoken = events
      .flatMap((event) => {
        if (event.kind !== 'acp_update') {
          return []
        }

        const update = event.notification.update

        return update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
          ? [update.content.text]
          : []
      })
      .join('')

    const rendered = state.items
      .filter((item): item is AgentTextItem => item.type === 'agent_text')
      .map((item) => item.text)
      .join('')

    expect(rendered).toBe(spoken)

    const thoughtChunks = events.filter(
      (event) =>
        event.kind === 'acp_update' &&
        event.notification.update.sessionUpdate === 'agent_thought_chunk',
    )

    const thoughtItems = state.items.filter((item) => item.type === 'agent_thought')

    /* Reasoning arrives as a stream of fragments and must be read as passages;
       a timeline with one row per fragment is not a timeline. */
    expect(thoughtItems.length).toBeLessThan(thoughtChunks.length)
    expect(thoughtItems.length).toBeGreaterThan(0)
  })

  it('leaves nothing still streaming once the turn is over', () => {
    const growing = state.items.filter(
      (item) => (item.type === 'agent_text' || item.type === 'agent_thought') && !item.sealed,
    )

    expect(growing).toStrictEqual([])
    expect(state.status).toBe('completed')
  })
})
