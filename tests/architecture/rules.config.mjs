/**
 * Architecture rules — data, not programs.
 *
 * Every rule is a regular expression evaluated against production source files.
 * Adding a rule means adding an object here; it never means adding a script.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/*
 * 扫描根必须是真实存在的顶层目录。
 *
 * 这份配置曾经声明 agent / editor / features / foundations / platforms，
 * 而重构后这五个目录一个都不剩，packages/ 又从未被列进来 —— 于是十四个包
 * 一行都没被扫过，Architecture rules passed. 是空转出来的绿。
 *
 * run.mjs 自己有一条 no-task-scoped-guards，理由是"守卫会随迁移过期然后无声
 * 腐烂"。它的配置正是这么烂掉的。所以这里不再只列名字，还要当场断言：
 * 声明了不存在的根，立刻抛错，而不是安静地少扫一片。
 */
export const sourceRoots = ['apps', 'packages']

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

for (const root of sourceRoots) {
  if (!existsSync(path.join(repositoryRoot, root))) {
    throw new Error(
      `architecture: sourceRoots 声明了不存在的目录 "${root}"。` +
        '目录被移动或删除后，这份配置必须同步更新，否则规则会静默失效。',
    )
  }
}

export const ignoredDirectories = new Set([
  '.git',
  '.turbo',
  'build',
  'dist',
  'generated',
  'node_modules',
  'target',
])

export const sourceExtensions = new Set(['.ts', '.tsx'])

const isProductionSource = (file) =>
  !/\.(?:test|spec)\.[jt]sx?$/.test(file) && !file.includes('/__tests__/')

const inDirectory = (directory) => (file) =>
  isProductionSource(file) && file.startsWith(`${directory}/`)

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const alternation = (values) => values.map(escapeForRegExp).join('|')

/*
 * Design-system control geometry, motion, elevation and stacking are owned by
 * the --ui-* custom properties. Raw utility classes fork that authority.
 */
const restrictedUtilityClasses = [
  { token: 'h-8', replacement: 'h-[var(--ui-control-height-sm)]' },
  { token: 'h-9', replacement: 'h-[var(--ui-control-height-md)]' },
  { token: 'h-10', replacement: 'h-[var(--ui-control-height-lg)]' },
  { token: 'w-9', replacement: 'w-[var(--ui-control-height-md)]' },
  { token: 'duration-150', replacement: 'duration-[var(--ui-duration-fast)]' },
  { token: 'z-50', replacement: 'z-[var(--ui-z-popover)]' },
  { token: 'shadow-2xl', replacement: 'shadow-[var(--ui-shadow-xl)]' },
]

export const rules = [
  {
    id: 'public-package-exports',
    appliesTo: isProductionSource,
    pattern: /from\s+['"]@poietica\/[^'"]+\/src\//g,
    message: 'cross-package imports must use public package exports, not src/ deep paths',
  },
  {
    id: 'no-cross-boundary-relative-imports',
    appliesTo: isProductionSource,
    pattern: /from\s+['"](?:\.\.\/){2,}(?:apps|packages)\//g,
    message: 'relative imports must not cross top-level package boundaries',
  },
  {
    id: 'design-system-token-authority',
    appliesTo: inDirectory('packages/ui/src/components'),
    pattern: new RegExp(
      '(?<![\\w-])(?:' +
        alternation(restrictedUtilityClasses.map((rule) => rule.token)) +
        ')(?![\\w-])',
      'g',
    ),
    message: 'design-system components must consume --ui-* tokens instead of raw utility classes',
    hint: (match) =>
      restrictedUtilityClasses.find((rule) => rule.token === match)?.replacement ?? null,
  },
]
