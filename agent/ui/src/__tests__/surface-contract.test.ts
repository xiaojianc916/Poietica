import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 这份测试守的是主题契约的完整性，不是某个颜色好不好看。
 *
 * 起因：一次用正则替换注释的改动，把 --ui-card / --ui-card-divider /
 * --ui-chrome / --ui-canvas / --ui-sidebar / --ui-sidebar-accent /
 * --ui-sidebar-accent-foreground 七个 token 连带删掉，设置页分组卡与侧边栏
 * 底色因此变成一片白，而当时的测试只断言了几个颜色字面值，全绿。
 *
 * 所以这里断言的是集合关系：两个主题必须声明同一批名字，且覆盖必需清单。
 * 任何单侧新增或删除都会红。
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

const light = readFileSync(join(tokensDir, 'light.css'), 'utf8')
const dark = readFileSync(join(tokensDir, 'dark.css'), 'utf8')
const surface = readFileSync(join(stylesDir, 'surface.css'), 'utf8')

/* 少一个就会有一整片界面失去取值。 */
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
  '--ui-surface-fill',
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

describe('surface contract', () => {
  it('外框宽度读全局那一个 1px，卡片不另开宽度档', () => {
    expect(surface).toContain('border: var(--ui-region-divider-width) solid var(--surface-line)')
    expect(surface).not.toContain('--ui-surface-frame-width')
  })

  it('外框与卡内分隔线走两个不同的 token', () => {
    expect(declOf(surface, '--surface-line')).toBe('var(--ui-surface-frame)')
    expect(declOf(surface, '--surface-rule')).toBe('var(--ui-divider-subtle)')
  })

  it('--ui-border 归控件，跟随区域线', () => {
    for (const css of [light, dark]) {
      expect(declOf(css, '--ui-border')).toBe('var(--ui-region-divider-color)')
    }
  })
})
