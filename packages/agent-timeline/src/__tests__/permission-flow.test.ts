import type { RunEvent } from '@poietica/acp'
import { describe, expect, it } from 'vitest'
import { replayRunEvents } from '../timeline-reducer'
import { selectIsBusy, selectPendingPermission } from '../timeline-selectors'

const OPTIONS = [
  { optionId: 'allow', name: '允许一次', kind: 'allow_once' },
  { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
] as const

const REQUESTED: RunEvent = {
  kind: 'permission_requested',
  seq: 1,
  at: 1_000,
  requestId: 'req-1',
  title: '允许读取 D:/poietica/README.md ?',
  options: OPTIONS,
}

const RESOLVED: RunEvent = {
  kind: 'permission_resolved',
  seq: 2,
  at: 1_100,
  requestId: 'req-1',
  optionId: 'allow',
  outcome: 'selected',
}

describe('permission flow', () => {
  it('blocks the run on an unanswered question', () => {
    const state = replayRunEvents([REQUESTED])
    const pending = selectPendingPermission(state)

    expect(state.status).toBe('awaiting_permission')
    expect(selectIsBusy(state)).toBe(true)

    /* The read model must expose what an answer needs, without re-narrowing. */
    expect(pending?.requestId).toBe('req-1')
    expect(pending?.options).toHaveLength(2)
  })

  it('stops pending once the answer is recorded', () => {
    const state = replayRunEvents([REQUESTED, RESOLVED])

    expect(selectPendingPermission(state)).toBeUndefined()
    expect(state.status).toBe('running')
    expect(state.items).toHaveLength(1)
  })

  it('ignores a replayed answer', () => {
    const once = replayRunEvents([REQUESTED, RESOLVED])
    const twice = replayRunEvents([REQUESTED, RESOLVED, RESOLVED])

    expect(twice.items).toStrictEqual(once.items)
    expect(twice.lastSeq).toBe(once.lastSeq)
  })
})
