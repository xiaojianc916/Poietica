import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 边框是一份契约，不是一个习惯。
 *
 * 五条都被违反过至少一次：外框被组件手写过、卡片令牌被第二个消费者借用过、
 * "只定义一次"同时定义在三个文件里过、行的落点落在半个设备像素上过、以及
 * 最久的那一条 —— 容器外框与区域分隔线是同一个取值，注释里甚至写明了"外框
 * 不动"。评审拦不住下一次。
 *
 * 两个细节决定这份断言可不可信：剥注释，因为讲历史的散文里必然出现被废弃的
 * 名字；needle 运行时拼接，否则这个文件自己就是最大的违规者。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DS = path.resolve(HERE, '../../../../foundations/design-system/src')
const ROOTS = [path.resolve(HERE, '..'), DS]

const LEGACY_CLASS = ['assistant', 'card'].join('-')
const LEGACY_TOKEN = ['--cp', 'card-'].join('-')
const SUFFIX = new Set(['.ts', '.tsx', '.css'])

/* 注释不是代码。散文里出现旧名字是记录，不是引用。 */
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '')

const read = (relative: string): string => readFileSync(path.resolve(HERE, relative), 'utf8')
const theme = (name: string): string =>
  strip(readFileSync(path.join(DS, 'styles/tokens', name), 'utf8'))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)

    if (statSync(full).isDirectory()) {
      return sources(full)
    }

    return SUFFIX.has(path.extname(name)) ? [full] : []
  })
}

const FILES = ROOTS.flatMap(sources)
const CARDS = [
  '../PermissionRequest.tsx',
  '../timeline/OutcomeCard.tsx',
  '../timeline/ToolCallCard.tsx',
]

describe('surface contract', () => {
  it('扫到了东西 —— 空集合的断言全都通过', () => {
    expect(FILES.length).toBeGreaterThan(40)
  })

  it('旧卡片类与旧卡片令牌在代码里已经没有落点', () => {
    for (const file of FILES) {
      const code = strip(readFileSync(file, 'utf8'))

      expect(code, file).not.toContain(LEGACY_CLASS)
      expect(code, file).not.toContain(LEGACY_TOKEN)
    }
  })

  it('三张卡都由 primitive 画框，没有一个自己写', () => {
    for (const file of CARDS) {
      expect(read(file), file).toContain('Surface')
    }
  })

  it.each(['light.css', 'dark.css'])('%s：容器外框不得与区域分隔线同值', (name) => {
    const css = theme(name)

    /* 这一条正是四轮之前就该有的：两个名字指向同一个取值，分级就不存在。 */
    expect(css).not.toContain('--ui-border: var(--ui-region-divider-color)')
    expect(css).toMatch(/--ui-border:\s*color-mix\(/)
    expect(css).toMatch(/--ui-divider-subtle:\s*color-mix\(/)
  })

  it('三档线各有其名，卡片内外都读命名档位', () => {
    const surface = readFileSync(path.join(DS, 'styles/surface.css'), 'utf8')

    expect(surface).toContain('--surface-line: var(--ui-border)')
    expect(surface).toContain('--surface-rule: var(--ui-divider-subtle)')
    expect(read('../timeline/timeline.css')).toContain('var(--surface-rule)')
    expect(read('../composer-metrics.css')).toContain('--cp-hairline: var(--ui-divider-subtle)')
  })

  it('行的落点对齐到设备像素 —— 否则 1px 的边会被摊成两行半墨', () => {
    expect(read('../feed/AgentActivityFeed.tsx')).toContain('snapToDevicePixels(item.start')
  })

  it('轨道预览卡的令牌带自己的前缀，不与 AI 回复卡共用', () => {
    const rail = read('../minimap/conversation-minimap.css')

    expect(rail).toContain('--cp-rail-card-y')
    expect(rail).toContain('--cp-rail-card-line')
  })
})
