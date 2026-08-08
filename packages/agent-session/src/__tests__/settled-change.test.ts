import type { SessionConfigControl } from '@poietica/acp'
import { describe, expect, it } from 'vitest'
import { settledChange } from '../settled-change'

function thought(current: string): readonly SessionConfigControl[] {
  return [
    {
      id: 'thinking',
      label: 'Thinking',
      purpose: 'thought',
      current,
      choices: [{ value: current, label: current }],
    },
  ]
}

describe('settledChange', () => {
  it('换模型之后再问一次，画的是第二张', async () => {
    const answers = [thought('low'), thought('off')]
    let asked = 0

    const settled = await settledChange('model', () => {
      const answer = answers[asked] ?? thought('off')

      asked += 1

      return Promise.resolve(answer)
    })

    expect(asked).toBe(2)
    expect(settled[0]?.current).toBe('off')
  })

  it('别的档位只问一次', async () => {
    let asked = 0

    const settled = await settledChange('thought', () => {
      asked += 1

      return Promise.resolve(thought('high'))
    })

    expect(asked).toBe(1)
    expect(settled[0]?.current).toBe('high')
  })

  it('认不出的控件按只问一次处理', async () => {
    let asked = 0

    await settledChange(undefined, () => {
      asked += 1

      return Promise.resolve(thought('high'))
    })

    expect(asked).toBe(1)
  })
})
