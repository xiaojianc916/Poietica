import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 这份测试守的不是"某个颜色好不好看"，是两条结构约束：
 *   1. 线与面的 token 必须是字面值，不能由 color-mix 推导 —— 推导过一轮，
 *      结果是取色器测到的值和源码里的数字对不上，没人能验证。
 *   2. 卡片外框必须比卡内分隔线重一档，且两者来自不同的 token。
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const styles = join(repoRoot, 'foundations', 'design-system', 'src', 'styles')

const light = readFileSync(join(styles, 'tokens', 'light.css'), 'utf8')
const dark = readFileSync(join(styles, 'tokens', 'dark.css'), 'utf8')
const surface = readFileSync(join(styles, 'surface.css'), 'utf8')
const metrics = readFileSync(join(repoRoot, 'agent', 'ui', 'src', 'composer-metrics.css'), 'utf8')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const declOf = (css: string, name: string) => {
  const hit = new RegExp(`^\\s*${name}:\\s*([^;]+);$`, 'm').exec(stripComments(css))
  expect(hit, `${name} 应当只被声明一次且可解析`).not.toBeNull()
  return hit![1].trim()
}

const LINE_TOKENS = [
  '--ui-region-divider-color',
  '--ui-divider-subtle',
  '--ui-surface-frame',
  '--ui-surface-fill',
]

describe('surface contract', () => {
  it('线与面的 token 是字面值，不由 color-mix 推导', () => {
    for (const theme of [light, dark]) {
      for (const token of LINE_TOKENS) {
        expect(declOf(theme, token)).not.toContain('color-mix')
      }
    }
  })

  it('浅色主题的取值就是取色器能测到的那几个', () => {
    expect(declOf(light, '--ui-surface-frame')).toBe('#ececec')
    expect(declOf(light, '--ui-divider-subtle')).toBe('#f2f2f2')
    expect(declOf(light, '--ui-surface-fill')).toBe('#fdfdfd')
    expect(declOf(light, '--ui-region-divider-color')).toBe('#e0e0e0')
  })

  it('外框与卡内分隔线是两个不同的 token，且不同值', () => {
    for (const theme of [light, dark]) {
      expect(declOf(theme, '--ui-surface-frame')).not.toBe(declOf(theme, '--ui-divider-subtle'))
    }
  })

  it('--ui-border 归控件，跟随区域线，不被卡片外框劫持', () => {
    for (const theme of [light, dark]) {
      expect(declOf(theme, '--ui-border')).toBe('var(--ui-region-divider-color)')
    }
  })

  it('外框走 2px，且只有 [data-surface] 画它', () => {
    expect(declOf(surface, '--ui-surface-frame-width')).toBe('2px')
    expect(surface).toContain('border: var(--ui-surface-frame-width) solid var(--surface-line)')
    expect(declOf(surface, '--surface-line')).toBe('var(--ui-surface-frame)')
    expect(declOf(surface, '--surface-rule')).toBe('var(--ui-divider-subtle)')
  })

  it('表格行线走内侧那一档，不走外框那一档', () => {
    expect(declOf(metrics, '--cp-hairline')).toBe('var(--ui-divider-subtle)')
  })
})
