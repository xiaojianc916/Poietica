import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 一、主题契约完整性。起因：一次用正则替换注释的改动把 --ui-card /
 *     --ui-chrome / --ui-sidebar 等七个 token 连带删掉，设置页分组卡与侧栏
 *     底色变成一片白，而当时的测试只看几个颜色字面值，全绿。
 * 二、两档线的数值不变量。外框相对画布的对比度必须是卡内线的 3～6 倍 ——
 *     低于 3 卡片就"化开"成一叠平行线（曾经是 1 倍，后来 2.2 倍，都不够）。
 * 三、卡片不许自己造背景，也不许自己开宽度档。
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const tokensDir = join(repoRoot, 'foundations', 'design-system', 'src', 'styles', 'tokens')
const stylesDir = join(repoRoot, 'foundations', 'design-system', 'src', 'styles')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const declaredTokens = (css: string) =>
  new Set([...stripComments(css).matchAll(/^\s*(--ui-[a-z0-9-]+):/gm)].map((m) => m[1]))

const declOf = (css: string, name: string) => {
  const hit = new RegExp(`^\\s*${name}:\\s*([^;]+);$`, 'm').exec(stripComments(css))
  expect(hit, `${name} 应当被声明且可解析`).not.toBeNull()
  return hit![1].trim()
}

/* 只接受 #rrggbb：能被取色器一比一核对的那种值。 */
const grayOf = (value: string) => {
  const hit = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  expect(hit, `${value} 应当是 #rrggbb 字面值`).not.toBeNull()
  return Number.parseInt(hit![1], 16)
}

const light = readFileSync(join(tokensDir, 'light.css'), 'utf8')
const dark = readFileSync(join(tokensDir, 'dark.css'), 'utf8')
const surface = readFileSync(join(stylesDir, 'surface.css'), 'utf8')
const metrics = readFileSync(join(repoRoot, 'agent', 'ui', 'src', 'composer-metrics.css'), 'utf8')

/* 画布取值来自 tokens/palette.css：neutral-50 ≈ #f8f8f8，dark-975 = #141414。 */
const CANVAS = { light: 0xf8, dark: 0x14 }

const REQUIRED = [
  '--ui-background',
  '--ui-foreground',
  '--ui-surface',
  '--ui-card',
  '--ui-card-divider',
  '--ui-chrome',
  '--ui-canvas',
  '--ui-sidebar',
  '--ui-sidebar-accent',
  '--ui-sidebar-accent-foreground',
  '--ui-region-divider-color',
  '--ui-divider',
  '--ui-divider-subtle',
  '--ui-border',
  '--ui-surface-frame',
  '--ui-surface-shadow',
  '--ui-input',
  '--ui-ring',
]

describe('theme token contract', () => {
  it('两个主题都覆盖必需的 token', () => {
    for (const [name, css] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const declared = declaredTokens(css)
      const missing = REQUIRED.filter((token) => !declared.has(token))
      expect(missing, `${name}.css 缺少 token`).toEqual([])
    }
  })

  it('两个主题声明的 token 集合完全一致', () => {
    const inLight = declaredTokens(light)
    const inDark = declaredTokens(dark)
    expect([...inLight].filter((t) => !inDark.has(t)).sort()).toEqual([])
    expect([...inDark].filter((t) => !inLight.has(t)).sort()).toEqual([])
  })
})

describe('two-tier border scale', () => {
  it('外框相对画布的对比度是卡内线的 3～6 倍', () => {
    for (const [name, css] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const canvas = CANVAS[name]
      const frame = Math.abs(grayOf(declOf(css, '--ui-surface-frame')) - canvas)
      const rule = Math.abs(grayOf(declOf(css, '--ui-divider-subtle')) - canvas)
      expect(rule, `${name}: 卡内线不能与画布同色`).toBeGreaterThan(0)
      const ratio = frame / rule
      expect(ratio, `${name}: 外框/卡内线 对比度比例`).toBeGreaterThanOrEqual(3)
      expect(ratio, `${name}: 外框/卡内线 对比度比例`).toBeLessThanOrEqual(6)
    }
  })

  it('外框比窗格线重，但不重到抢戏', () => {
    const frame = grayOf(declOf(light, '--ui-surface-frame'))
    const region = grayOf(declOf(light, '--ui-region-divider-color'))
    expect(frame).toBeLessThan(region)
    expect(CANVAS.light - frame).toBeLessThanOrEqual(42)
  })

  it('卡片不造背景，存在感由投影给', () => {
    expect(surface).not.toContain('background')
    expect(light).not.toContain('--ui-surface-fill')
    expect(dark).not.toContain('--ui-surface-fill')
    expect(surface).toContain('box-shadow: var(--ui-surface-shadow)')
  })

  it('宽度只有全局那一档 1px', () => {
    expect(surface).toContain('border: var(--ui-region-divider-width) solid var(--surface-line)')
    expect(surface).not.toContain('--ui-surface-frame-width')
  })

  it('外框、卡内线、表格行线各读对档位', () => {
    expect(declOf(surface, '--surface-line')).toBe('var(--ui-surface-frame)')
    expect(declOf(surface, '--surface-rule')).toBe('var(--ui-divider-subtle)')
    expect(declOf(metrics, '--cp-hairline')).toBe('var(--ui-divider-subtle)')
  })

  it('--ui-border 归控件，跟随区域线', () => {
    for (const css of [light, dark]) {
      expect(declOf(css, '--ui-border')).toBe('var(--ui-region-divider-color)')
    }
  })
})
