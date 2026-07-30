import type { RunEvent } from '@poietica/agent-protocol'
import { describe, expect, it } from 'vitest'
import { SAMPLE_RUN_EVENTS } from '../__fixtures__/timeline-fixtures'
import { applyRunEvent, createTimelineState, replayRunEvents } from '../timeline-reducer'

const runId = 'run_test'

describe('timeline reducer', () => {
  it('projects a recorded run into a flat timeline', () => {
    const state = replayRunEvents(runId, SAMPLE_RUN_EVENTS)

    expect(state.status).toBe('completed')
    expect(state.items.map((item) => item.type)).toEqual([
      'user_message',
      'agent_thought',
      'plan',
      'tool_call',
      'agent_text',
    ])

    const thought = state.items.find((item) => item.type === 'agent_thought')
    expect(thought && thought.type === 'agent_thought' && thought.text).toBe(
      '先读取 README，再与 package.json 对照。',
    )

    const tool = state.items.find((item) => item.type === 'tool_call')
    expect(tool && tool.type === 'tool_call' && tool.status).toBe('completed')
    expect(tool && tool.type === 'tool_call' && tool.endedAt).toBe(1_090)
  })

  it('keeps tool output inside the protocol envelope', () => {
    const state = replayRunEvents(runId, SAMPLE_RUN_EVENTS)
    const tool = state.items.find((item) => item.type === 'tool_call')

    /* A bare content block here would mean either the boundary reshaped the
       frame or the sample drifted away from what an agent actually sends. */
    expect(tool && tool.type === 'tool_call' && tool.content).toEqual([
      { type: 'content', content: { type: 'text', text: '# Poietica ...' } },
    ])
  })

  it('is idempotent under duplicated events', () => {
    const once = replayRunEvents(runId, SAMPLE_RUN_EVENTS)
    const twice = replayRunEvents(runId, [...SAMPLE_RUN_EVENTS, ...SAMPLE_RUN_EVENTS])

    expect(twice.items).toEqual(once.items)
    expect(twice.status).toBe(once.status)
  })

  it('keeps a tool_call_update that arrives before its tool_call', () => {
    const orphan: RunEvent = {
      kind: 'acp_update',
      seq: 1,
      at: 10,
      notification: {
        sessionId: 's',
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_x', status: 'completed' },
      },
    }

    const state = applyRunEvent(createTimelineState(runId), orphan)
    const tool = state.items.at(0)

    expect(tool && tool.type === 'tool_call' && tool.toolCallId).toBe('call_x')
    expect(tool && tool.type === 'tool_call' && tool.status).toBe('completed')
  })

  it('replaces the plan wholesale instead of merging entries', () => {
    const plan = (seq: number, content: string): RunEvent => ({
      kind: 'acp_update',
      seq,
      at: seq,
      notification: {
        sessionId: 's',
        update: {
          sessionUpdate: 'plan',
          entries: [{ content, status: 'pending', priority: 'low' }],
        },
      },
    })

    const state = replayRunEvents(runId, [plan(1, 'first'), plan(2, 'second')])
    const plans = state.items.filter((item) => item.type === 'plan')

    expect(plans).toHaveLength(1)
    expect(plans.at(0)?.type === 'plan' && plans.at(0)).toMatchObject({
      entries: [{ content: 'second' }],
    })
  })
})
