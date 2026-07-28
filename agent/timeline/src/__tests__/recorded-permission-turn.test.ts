import type { RunEvent } from '@poietica/agent-protocol'
import type { PermissionItem, ToolCallTimelineItem } from '@poietica/agent-timeline'
import { describe, expect, it } from 'vitest'
import { recordedTurn } from '../__fixtures__/permission-turn.generated'
import { parseRunEvent } from '../acp-event-schema'
import { replayRunEvents } from '../timeline-reducer'

/**
 * The reducer, driven by a real permission request.
 *
 * Recorded against Kimi with a prompt that had to write a file. Nobody ever
 * answered: the watchdog cancelled the turn, and the agent resolved its own
 * question as cancelled. That is not an edge case to tolerate, it is the
 * ordinary outcome whenever the person who was asked walks away.
 *
 * Every expectation below is computed from the recording. Numbers copied out of
 * one run would only prove that the run happened.
 */

const events: readonly RunEvent[] = recordedTurn.flatMap((frame) => {
  const parsed = parseRunEvent(frame.frame)
  return parsed.ok ? [parsed.event] : []
})

const state = replayRunEvents('run-permission-turn', events)

const requests = events.filter(
  (event): event is Extract<RunEvent, { kind: 'permission_requested' }> =>
    event.kind === 'permission_requested',
)

const resolutions = events.filter(
  (event): event is Extract<RunEvent, { kind: 'permission_resolved' }> =>
    event.kind === 'permission_resolved',
)

const finishes = events.filter(
  (event): event is Extract<RunEvent, { kind: 'run_finished' }> => event.kind === 'run_finished',
)

const permissionItems = state.items.filter(
  (item): item is PermissionItem => item.type === 'permission',
)

const toolItems = state.items.filter(
  (item): item is ToolCallTimelineItem => item.type === 'tool_call',
)

describe('a recorded permission turn', () => {
  it('was recorded for the question it contains', () => {
    /* Guards the fixture, not the reducer: a recording of a turn that needed no
       permission would make every assertion below vacuous. */
    expect(requests).toHaveLength(1)
    expect(resolutions).toHaveLength(1)
  })

  it('accepts every frame at the boundary', () => {
    expect(events).toHaveLength(recordedTurn.length)
    expect(state.lastSeq).toBe(recordedTurn.length)
  })

  it('asks once, and the question keeps the identity the agent gave it', () => {
    const request = requests.at(0)

    expect(permissionItems).toHaveLength(requests.length)
    expect(permissionItems.at(0)?.requestId).toBe(request?.requestId)
    expect(permissionItems.at(0)?.title).toBe(request?.title)
    expect(permissionItems.at(0)?.options.length).toBeGreaterThan(0)
  })

  it('answers nothing on its own', () => {
    const resolution = resolutions.at(0)

    /* Nothing in the client selected an option, so the turn ended the only
       honest way it could. If this ever reads 'selected' after an unattended
       recording, something started deciding on the user behalf. */
    expect(resolution?.outcome).toBe('cancelled')
    expect(permissionItems.at(0)?.resolution).toEqual({
      optionId: resolution?.optionId,
      outcome: resolution?.outcome,
    })
  })

  it('holds the run open for as long as the question is unanswered', () => {
    const askedAt = requests.at(0)?.seq ?? 0
    const upToTheQuestion = events.filter((event) => event.seq <= askedAt)

    expect(replayRunEvents('run-permission-prefix', upToTheQuestion).status).toBe(
      'awaiting_permission',
    )
    expect(state.status).not.toBe('awaiting_permission')
  })

  it('ends the way the agent said the turn ended', () => {
    expect(finishes).toHaveLength(1)
    expect(finishes.at(0)?.stopReason).toBe('cancelled')
    expect(state.status).toBe('cancelled')
  })

  it('leaves each tool call where its last update left it', () => {
    const lastStatus = new Map<string, ToolCallTimelineItem['status']>()

    for (const event of events) {
      if (event.kind !== 'acp_update') {
        continue
      }
      const update = event.notification.update
      if (update.sessionUpdate === 'tool_call') {
        lastStatus.set(update.toolCallId, update.status)
      }
      if (update.sessionUpdate === 'tool_call_update' && update.status !== undefined) {
        lastStatus.set(update.toolCallId, update.status)
      }
    }

    expect(toolItems).toHaveLength(lastStatus.size)

    for (const item of toolItems) {
      expect(item.status).toBe(lastStatus.get(item.toolCallId))
      const terminal = item.status === 'completed' || item.status === 'failed'
      expect(item.endedAt !== undefined).toBe(terminal)
    }
  })
})
