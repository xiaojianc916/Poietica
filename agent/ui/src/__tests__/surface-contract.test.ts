import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 边框是一份契约，不是一个习惯。
 *
 * 三条都被人手违反过至少一次：卡片外框被手写过、卡片令牌被第二个消费者
 * 借用过、"只定义一次"被同时定义在三个文件里过。评审拦不住下一次，所以
 * 写在这里。
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const STYLES = [
  '../composer-metrics.css',
  '../permission-request.css',
  '../timeline/outcome-card.css',
  '../timeline/timeline.css',
]

const CARDS = [
  '../PermissionRequest.tsx',
  '../timeline/OutcomeCard.tsx',
  '../timeline/ToolCallCard.tsx',
]

describe('surface contract', () => {
  it('卡片令牌已经没有第二个定义处或消费者', () => {
    for (const file of [...STYLES, ...CARDS]) {
      expect(read(file), file).not.toContain('--cp-card-')
    }
  })

  it('没有组件自己画外框', () => {
    for (const file of CARDS) {
      expect(read(file), file).not.toContain('assistant-card')
      expect(read(file), file).toContain('Surface')
    }
  })

  it('卡内分隔线读的是卡片下发的那一档', () => {
    expect(read('../timeline/timeline.css')).toContain('var(--surface-rule)')
  })
})
