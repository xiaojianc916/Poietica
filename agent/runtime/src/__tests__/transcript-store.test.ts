import { describe, expect, it } from 'vitest'
import { TranscriptStore } from '../transcript-store'

describe('transcript store', () => {
  /* 这个用例本身就是这次重构的目的：此前拿不到干净实例，写不出它。 */
  it('keeps two stores apart', () => {
    const one = new TranscriptStore()
    const other = new TranscriptStore()

    expect(one.newDraft()).toBe(other.newDraft())
  })

  it('shows what was said even when there is nowhere to send it', () => {
    const store = new TranscriptStore()
    const key = store.newDraft()
    let told = 0

    store.subscribe(key, () => {
      told += 1
    })

    store.send({ port: undefined, key, endpoint: null, text: '在吗' })

    const { timeline } = store.read(key)

    expect(timeline.items.map((item) => item.type)).toEqual(['user_message', 'error'])
    expect(timeline.status).toBe('failed')
    expect(told).toBe(2)
  })
})
