import type { SessionConfigControl } from '@poietica/acp'
import { describe, expect, it } from 'vitest'
import {
  agentChoices,
  chooseAgentControl,
  installAgentCapabilityPort,
  refreshAgentCapabilities,
} from '../agent-capability-store'

/*
 * 这台 store 不认识 React、不认识进程，也不认识 IPC：它只认一个端口。所以这三例
 * 全部只靠一个手写端口跑，没有假时钟、没有渲染器。测不了才说明分层是错的。
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

/* 两个模型报的两张表。档位候选不同，正是"档位随模型变"这件事本身。 */
const ON_OFF: readonly SessionConfigControl[] = [
  control('model', 'model', 'kimi-k2', ['kimi-k2', 'kimi-k3']),
  control('thought', 'thought', 'off', ['off', 'on']),
]

const THREE_TIER: readonly SessionConfigControl[] = [
  control('model', 'model', 'kimi-k3', ['kimi-k2', 'kimi-k3']),
  control('thought', 'thought', 'high', ['off', 'high', 'max']),
]

/* 让已经 resolve 的那些 then 跑完。这里没有计时器，所以不需要假时钟。 */
async function settled(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve()
  }
}

describe('agent capability store', () => {
  it('换模型时档位随同一次答复一起换掉', async () => {
    const port = {
      read: () => Promise.resolve(ON_OFF),
      select: () => Promise.resolve(THREE_TIER),
    }

    installAgentCapabilityPort(port)

    const stop = agentChoices.observe(() => undefined)

    refreshAgentCapabilities()
    await settled()

    expect(agentChoices.chosenOf('thought')).toBe('off')

    chooseAgentControl('model', 'kimi-k3')
    await settled()

    expect(agentChoices.chosenOf('model')).toBe('kimi-k3')
    expect(agentChoices.chosenOf('thought')).toBe('high')

    stop()
  })

  it('飞在半路的旧读取不覆盖新答复', async () => {
    let release: ((table: readonly SessionConfigControl[]) => void) | undefined
    let reads = 0

    const port = {
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
    }

    installAgentCapabilityPort(port)

    const stop = agentChoices.observe(() => undefined)

    refreshAgentCapabilities()
    await settled()

    /* 第二次读取还在飞，切换的答复先回来。 */
    refreshAgentCapabilities()
    chooseAgentControl('model', 'kimi-k3')
    await settled()

    expect(agentChoices.chosenOf('thought')).toBe('high')

    release?.(ON_OFF)
    await settled()

    /* 旧读取到得晚，代次已经过期：屏幕上仍是新表，而不是谁后回来谁赢。 */
    expect(agentChoices.chosenOf('thought')).toBe('high')

    stop()
  })

  it('agent 从没提供过的值不下发', async () => {
    let asked = 0

    const port = {
      read: () => Promise.resolve(ON_OFF),
      select: () => {
        asked += 1

        return Promise.resolve(THREE_TIER)
      },
    }

    installAgentCapabilityPort(port)

    const stop = agentChoices.observe(() => undefined)

    refreshAgentCapabilities()
    await settled()

    chooseAgentControl('thought', 'max')
    await settled()

    expect(asked).toBe(0)
    expect(agentChoices.chosenOf('thought')).toBe('off')

    stop()
  })
})
