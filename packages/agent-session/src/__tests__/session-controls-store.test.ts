import type {
  OpenedThread,
  SessionConfigControl,
  SessionConfigPort,
  SessionConfigReport,
} from '@poietica/acp'
import { describe, expect, it } from 'vitest'

import { SessionControlsStore } from '../session-controls-store'

/*
 * 一条对话的那张表，只认一个端口：不认识 React、不认识进程、也不认识 IPC。
 */

const THREAD = 'thread-1'
const SESSION = 'session-1'

const control = (
  id: string,
  purpose: SessionConfigControl['purpose'],
  current: string,
  values: readonly string[],
): SessionConfigControl => ({
  id,
  label: id,
  purpose,
  current,
  choices: values.map((value) => ({ value, label: value })),
})

/* 档位候选属于模型：前一个模型有 low，后一个没有。 */
const WITH_LOW: readonly SessionConfigControl[] = [
  control('model', 'model', 'kimi-k3', ['kimi-k3', 'deepseek-v4']),
  control('thought', 'thought', 'low', ['low', 'medium', 'high']),
]

const WITHOUT_LOW: readonly SessionConfigControl[] = [
  control('model', 'model', 'deepseek-v4', ['kimi-k3', 'deepseek-v4']),
  control('thought', 'thought', 'medium', ['medium', 'high']),
]

/* agent 换完模型先答复的那一张：模型换了，档位那一行还是上一个模型的。 */
const UNCONVERGED: readonly SessionConfigControl[] = [
  control('model', 'model', 'deepseek-v4', ['kimi-k3', 'deepseek-v4']),
  control('thought', 'thought', 'low', ['low', 'medium', 'high']),
]

const opened = (selectors: readonly SessionConfigControl[]): OpenedThread => ({
  thread: {
    threadId: THREAD,
    sessionId: SESSION,
    title: '',
    titleSource: 'fallback',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  selectors,
  events: [],
  history: { state: 'fresh' },
  attachments: [],
  prompts: 0,
})

/* 让已经兑现的那些 then 跑完。这里没有计时器，所以不需要假时钟。 */
async function settled(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve()
  }
}

const valueOf = (store: SessionControlsStore, id: string): string | undefined =>
  store.selectorsOf(THREAD)?.find((offered) => offered.id === id)?.current

describe('一条对话的那张表', () => {
  it('agent 先推收敛过的表、答复后到，屏幕留的是收敛过的那一张', async () => {
    let announce: ((report: SessionConfigReport) => void) | undefined
    let release: ((offered: readonly SessionConfigControl[]) => void) | undefined

    const config: SessionConfigPort = {
      select: () =>
        new Promise<readonly SessionConfigControl[]>((resolve) => {
          release = resolve
        }),
      subscribe: (handler) => {
        announce = handler

        return () => {
          announce = undefined
        }
      },
    }

    const store = new SessionControlsStore({ announce: () => undefined, config })
    const stop = store.start()

    store.opened(opened(WITH_LOW))

    expect(valueOf(store, 'thought')).toBe('low')

    store.selectControl(THREAD, 'model', 'deepseek-v4')
    await settled()

    /* agent 自己收敛了一次，推的是新模型真在用的那张表。 */
    announce?.({ sessionId: SESSION, controls: WITHOUT_LOW })

    /* 这一趟答复是在那声推送之前发出的，它带的档位属于上一个模型。 */
    release?.(UNCONVERGED)
    await settled()

    expect(valueOf(store, 'model')).toBe('deepseek-v4')
    expect(valueOf(store, 'thought')).toBe('medium')

    stop()
  })

  it('agent 不补推时，答复仍然就是那张表', async () => {
    const config: SessionConfigPort = {
      select: () => Promise.resolve(WITHOUT_LOW),
      subscribe: () => () => undefined,
    }

    const store = new SessionControlsStore({ announce: () => undefined, config })
    const stop = store.start()

    store.opened(opened(WITH_LOW))
    store.selectControl(THREAD, 'thought', 'medium')
    await settled()

    expect(valueOf(store, 'thought')).toBe('medium')

    stop()
  })
})
