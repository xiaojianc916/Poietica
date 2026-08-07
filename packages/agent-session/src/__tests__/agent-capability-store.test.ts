import type { SessionConfigControl } from '@poietica/acp'
import { describe, expect, it } from 'vitest'

import { AgentCapabilityStore } from '../agent-capability-store'

/*
 * 每个用例造一份自己的 store。
 *
 * 它不认识 React、不认识进程，也不认识 IPC，只认一个端口 —— 此前这些用例共用
 * 进程里那一个实例，顺序一换结论就换。
 */

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

/* 两个模型报的两张表。档位候选不同，那正是"档位随模型变"这件事本身。 */
const ON_OFF: readonly SessionConfigControl[] = [
  control('model', 'model', 'kimi-k2', ['kimi-k2', 'kimi-k3']),
  control('thought', 'thought', 'off', ['off', 'on']),
]

const THREE_TIER: readonly SessionConfigControl[] = [
  control('model', 'model', 'kimi-k3', ['kimi-k2', 'kimi-k3']),
  control('thought', 'thought', 'high', ['off', 'high', 'max']),
]

/* 让已经兑现的那些 then 跑完。这里没有计时器，所以不需要假时钟。 */
async function settled(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve()
  }
}

const valueOf = (table: readonly SessionConfigControl[], id: string): string | undefined =>
  table.find((offered) => offered.id === id)?.current

describe('锚会话的那张表', () => {
  it('换模型时档位随同一次答复一起换掉', async () => {
    const store = new AgentCapabilityStore()

    store.installPort({
      read: () => Promise.resolve(ON_OFF),
      select: () => Promise.resolve(THREE_TIER),
    })

    const stop = store.subscribe(() => undefined)

    await settled()

    expect(valueOf(store.snapshot(), 'thought')).toBe('off')

    store.choose('model', 'kimi-k3')
    await settled()

    /* 一次答复整张换掉：不存在"新模型 + 旧档位"这种中间形态。 */
    expect(valueOf(store.snapshot(), 'model')).toBe('kimi-k3')
    expect(valueOf(store.snapshot(), 'thought')).toBe('high')

    stop()
  })

  it('飞在半路的旧读取不覆盖新答复', async () => {
    const store = new AgentCapabilityStore()

    let release: ((table: readonly SessionConfigControl[]) => void) | undefined
    let reads = 0

    store.installPort({
      read: () => {
        reads += 1

        if (reads === 1) {
          return Promise.resolve(ON_OFF)
        }

        return new Promise<readonly SessionConfigControl[]>((resolve) => {
          release = resolve
        })
      },
      select: () => Promise.resolve(THREE_TIER),
    })

    const stop = store.subscribe(() => undefined)

    await settled()

    /* 第二次读取还在飞的时候，切换的答复先回来。 */
    store.refresh()
    store.choose('model', 'kimi-k3')
    await settled()

    expect(valueOf(store.snapshot(), 'thought')).toBe('high')

    release?.(ON_OFF)
    await settled()

    /* 该赢的是问得晚的那一个，不是回来得晚的那一个。 */
    expect(valueOf(store.snapshot(), 'thought')).toBe('high')

    stop()
  })

  it('agent 从没提供过的值不下发', async () => {
    const store = new AgentCapabilityStore()

    let asked = 0

    store.installPort({
      read: () => Promise.resolve(ON_OFF),
      select: () => {
        asked += 1

        return Promise.resolve(THREE_TIER)
      },
    })

    const stop = store.subscribe(() => undefined)

    await settled()

    /* 这张表的档位只有 off/on：max 不属于它，发出去只会换回一个错误。 */
    store.choose('thought', 'max')
    await settled()

    expect(asked).toBe(0)
    expect(valueOf(store.snapshot(), 'thought')).toBe('off')

    stop()
  })
})
