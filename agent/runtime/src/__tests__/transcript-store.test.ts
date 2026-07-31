import type { AgentSessionPort, RunEvent } from '@poietica/agent-protocol'
import { describe, expect, it } from 'vitest'
import { TranscriptStore } from '../transcript-store'

/* 一条假线路：帧从哪来不重要，重要的是它带着哪条会话号。 */
function fakePort(): {
  readonly port: AgentSessionPort
  readonly emit: (event: RunEvent, sessionId: string) => void
} {
  const listeners = new Set<(event: RunEvent, sessionId: string) => void>()

  return {
    port: {
      subscribe: (listener) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      },
      prompt: () => Promise.resolve({ sessionId: 'sess_a' }),
      cancel: () => Promise.resolve(),
      resolvePermission: () => Promise.resolve(),
    },
    emit: (event, sessionId) => {
      for (const listener of listeners) {
        listener(event, sessionId)
      }
    },
  }
}

function started(seq: number, sessionId: string): RunEvent {
  return { kind: 'run_started', seq, at: seq, sessionId, prompt: '在吗' }
}

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

  it('把帧交给持有这条会话的那条对话', () => {
    const store = new TranscriptStore()
    const { port, emit } = fakePort()

    store.ensure(port)
    store.route('sess_a', 'thread_a')
    store.route('sess_b', 'thread_b')

    const untouched = store.read('thread_a')

    emit(started(1, 'sess_b'), 'sess_b')

    expect(store.read('thread_a')).toBe(untouched)
    expect(store.read('thread_b')).not.toBe(untouched)
  })

  it('没有登记过的会话，它的帧就地丢掉', () => {
    const store = new TranscriptStore()
    const { port, emit } = fakePort()

    store.ensure(port)
    store.route('sess_a', 'thread_a')

    const untouched = store.read('thread_a')

    emit(started(1, 'sess_x'), 'sess_x')

    /* 不排队、不补投、不占内存：地址先于帧到达，等待没有意义。 */
    expect(store.read('thread_a')).toBe(untouched)
  })

  it('一轮结束不会带走这条会话的地址', () => {
    const store = new TranscriptStore()
    const { port, emit } = fakePort()

    store.ensure(port)
    store.route('sess_a', 'thread_a')

    emit(started(1, 'sess_a'), 'sess_a')
    emit({ kind: 'run_finished', seq: 2, at: 2, stopReason: 'end_turn' }, 'sess_a')

    const ended = store.read('thread_a')

    /* 会话跨轮存活。此前这里是按轮次记的，第二轮的帧会变成无主的。 */
    emit(started(3, 'sess_a'), 'sess_a')

    expect(store.read('thread_a')).not.toBe(ended)
  })
})
