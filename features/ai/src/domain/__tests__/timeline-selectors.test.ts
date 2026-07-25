import { describe, expect, it } from 'vitest'

import { SAMPLE_RUN_EVENTS } from '../timeline-fixtures'
import { replayRunEvents } from '../timeline-reducer'
import { selectFeedRows, selectIsBusy } from '../timeline-selectors'

describe('timeline selectors', () => {
  it('marks no streaming tail once the run has finished', () => {
    const state = replayRunEvents('run', SAMPLE_RUN_EVENTS)
    const rows = selectFeedRows(state)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => !row.isStreamingTail)).toBe(true)
    expect(selectIsBusy(state)).toBe(false)
  })

  it('marks the growing tail while the run is live', () => {
    const partial = SAMPLE_RUN_EVENTS.filter((event) => event.kind !== 'run_finished')
    const rows = selectFeedRows(replayRunEvents('run', partial))

    expect(rows.at(-1)?.isStreamingTail).toBe(true)
  })
})
