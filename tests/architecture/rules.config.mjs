/**
 * Architecture rules — data, not programs.
 *
 * Every rule is a regular expression evaluated against production source files.
 * Adding a rule means adding an object here; it never means adding a script.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

/*
 * 扫描根必须是真实存在的顶层目录。
 *
 * 这份配置曾经声明 agent / editor / features / foundations / platforms，
 * 重构后五个目录一个不剩，packages/ 又从未被列进来 —— 十四个包一行没被扫过，
 * Architecture rules passed. 是空转出来的绿。所以不只列名字，还要当场断言。
 */
export const sourceRoots = ['apps', 'packages']

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
 * 依赖方向。
 *
 * 层次不是从目录名或包名前缀推断的 —— 上一版正是这么做的，命名法一改
 * 规则就整体失效，而且失效时不报错。这里是一张显式的表，加载时逐条断言。
 *
 * 分层依据是十五份 manifest 里真实存在的三十条工作区边，不是设想中的目标态。
 * 每一条现存的边都指向同层或更低层，所以这套规则开启时零违规。
 *
 * transport 与 composition 分成两层，而不是合成一个 "platform"：
 * ipc 只依赖 acp，被 settings / desktop-runtime / desktop 依赖，位置在 features
 * 之下；desktop-runtime 依赖 agent-registry + ipc + settings，且只被应用入口
 * 依赖，位置在 features 之上。上一版把两者塞进同一层，于是不得不写一段注释
 * 解释为什么 platform 可以反向依赖 features。分开之后，那个破例不存在了。
 */
const tiers = [
  { name: 'foundations', packages: ['core', 'observability', 'serialization', 'test-kit', 'ui'] },
  { name: 'protocol', packages: ['acp'] },
  { name: 'domain', packages: ['agent-registry', 'agent-session', 'agent-timeline'] },
  { name: 'transport', packages: ['ipc'] },
  { name: 'features', packages: ['agent-ui', 'settings', 'workspace'] },
  { name: 'composition', packages: ['desktop-runtime'] },
  { name: 'application', packages: ['desktop'] },
]

/* 只有这三个包可以直连原生宿主。其余任何一个碰 @tauri-apps 都是越界。 */
const nativeAllowed = new Set(['desktop', 'desktop-runtime', 'ipc'])

const directoryOf = (pkg) => {
  for (const root of sourceRoots) {
    if (existsSync(path.join(repositoryRoot, root, pkg, 'package.json'))) {
      return `${root}/${pkg}`
    }
  }
  throw new Error(`architecture: 分层表里的 "${pkg}" 在磁盘上不存在`)
}

const declaredNameOf = (directory) =>
  JSON.parse(readFileSync(path.join(repositoryRoot, directory, 'package.json'), 'utf8')).name

const placed = new Map()
for (const [index, tier] of tiers.entries()) {
  for (const pkg of tier.packages) {
    if (placed.has(pkg)) {
      throw new Error(`architecture: "${pkg}" 被放进了不止一层`)
    }
    placed.set(pkg, index)
  }
}

/*
 * 新增一个包却没有给它定层，就在这里失败 —— 而不是安静地不受任何方向约束。
 * 旧规则想要的正是这个效果，但它靠的是命名约定，所以做不到。
 */
for (const root of sourceRoots) {
  for (const entry of readdirSync(path.join(repositoryRoot, root), { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    if (!existsSync(path.join(repositoryRoot, root, entry.name, 'package.json'))) {
      continue
    }
    if (!placed.has(entry.name)) {
      throw new Error(
        `architecture: ${root}/${entry.name} 没有出现在分层表里。` +
          '新增包必须先声明它属于哪一层，才能被允许 import 任何东西。',
      )
    }
  }
}

/* 允许集按包名拼装，所以包名与目录名必须一致，否则规则会指向错误的东西。 */
for (const [pkg] of placed) {
  const directory = directoryOf(pkg)
  const declared = declaredNameOf(directory)
  if (declared !== `@poietica/${pkg}`) {
    throw new Error(
      `architecture: ${directory} 的包名是 "${declared}"，与目录名不一致。` +
        '分层表按目录名索引、按包名生成允许集，两者必须对齐。',
    )
  }
}

/*
 * 判据是 import 说明符，不是包名在文本里出现过。后行断言零宽，match.index
 * 仍落在包名上，报出来的列号才继续指着出问题的那个字。
 */
const SPECIFIER = String.raw`(?<=(?:from|import)\s*\(?\s*['"])`

const tierRules = [...placed].map(([pkg, index]) => {
  const allowed = tiers.slice(0, index + 1).flatMap((tier) => tier.packages)
  const forbidden = [`${SPECIFIER}@poietica/(?!(?:${alternation(allowed)})['"/])[\\w-]+`]

  if (!nativeAllowed.has(pkg)) {
    forbidden.push(`${SPECIFIER}@tauri-apps/[\\w-]+`)
  }

  return {
    id: `${pkg}-depends-downward`,
    appliesTo: inDirectory(directoryOf(pkg)),
    pattern: new RegExp(forbidden.join('|'), 'g'),
    message: `${pkg}（${tiers[index].name}）只能依赖 ${allowed.join(', ')}`,
  }
})

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
  ...tierRules,
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
