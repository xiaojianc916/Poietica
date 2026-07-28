import { parseRunEvent } from '@poietica/agent-protocol'
import { describe, expect, it } from 'vitest'
import { applyRunEvent, createTimelineState } from '../timeline-reducer'

/*
 * The question is shown because it was recorded.
 *
 * These frames are the shape the recorder writes, checked through the same
 * boundary the transport uses, so a renamed field fails here rather than
 * silently emptying the conversation.
 */

const runId = 'run_test'

describe('a run that carries its prompt', () => {
  it('accepts the recorded frame at the boundary', () => {
    const parsed = parseRunEvent({
      kind: 'run_started',
      seq: 1,
      at: 1_000,
      sessionId: 'sess_alpha',
      prompt: '读取 README',
    })

    expect(parsed.ok).toBe(true)
  })

  it('opens the timeline with what the user said', () => {
    const parsed = parseRunEvent({
      kind: 'run_started',
      seq: 1,
      at: 1_000,
      sessionId: 'sess_alpha',
      prompt: '读取 README',
    })

    if (!parsed.ok) {
      throw new Error('the boundary rejected a frame the recorder writes')
    }

    const state = applyRunEvent(createTimelineState(runId), parsed.event)
    const first = state.items.at(0)

    expect(state.status).toBe('running')
    expect(first && first.type === 'user_message' && first.text).toBe('读取 README')
  })

  it('adds nothing when an older recording carries no prompt', () => {
    const parsed = parseRunEvent({
      kind: 'run_started',
      seq: 1,
      at: 1_000,
      sessionId: 'sess_alpha',
    })

    if (!parsed.ok) {
      throw new Error('the boundary rejected a frame every recording contains')
    }

    expect(applyRunEvent(createTimelineState(runId), parsed.event).items).toEqual([])
  })
})
