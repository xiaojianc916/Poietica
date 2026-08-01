/**
 * Architecture rules — data, not programs.
 *
 * Every rule is a regular expression evaluated against production source files.
 * Adding a rule means adding an object here; it never means adding a script.
 */

export const sourceRoots = ['agent', 'apps', 'editor', 'features', 'foundations', 'platforms']

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

const inLayer = (layer) => (file) => isProductionSource(file) && file.startsWith(`${layer}/`)

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

/*
 * What each layer may depend on, besides foundations and itself.
 *
 * Package names are regular — @poietica/<layer>-<name>, plus the single
 * application package @poietica/desktop — so direction can be read off the
 * specifier. The blacklists this replaces still named @poietica/workspace and
 * @poietica/settings after those packages became @poietica/features-*, and
 * never learnt the agent tier existed. A table of layers cannot rot that way:
 * a renamed package keeps its prefix, and a new layer must be added here
 * before its files are allowed to import anything at all.
 *
 * native: may reach for @tauri-apps directly. Only platform packages may.
 *
 * platforms: 适配器实现的是别人声明的端口，所以它必须看得见那些端口。
 * createDesktopSettingsStore 的返回类型就是 features-settings 的 SettingsStore，
 * 这个 import 删不掉 —— 删了函数就没有类型可标注。agents.json 读回来的不透明
 * 对象要由 agent-registry 校验成 AcpAgentProfile，同理。这两条边是依赖倒置的
 * 落点，不是抄近路。
 *
 * 真正要防的是反向那条：platforms 依赖应用入口包 @poietica/desktop。它仍然禁着。
 */
const layers = {
  agent: { may: [], native: false },
  editor: { may: [], native: false },
  features: { may: ['agent', 'editor'], native: false },
  foundations: { may: [], native: false },
  platforms: { may: ['agent', 'features'], native: true },
}

/*
 * 依赖方向的判据是 import 说明符，不是包名在文本里出现过。
 *
 * 此前这条规则在全文里搜包名，于是一句「agents 是不透明对象，由
 * @poietica/agent-registry 在 TS 侧校验」的注释也被记成一次跨层依赖。注释不是
 * 依赖：它不进构建产物，删掉它不会改变任何一条边。改用与 public-package-exports
 * 相同的判据，只认 from / import 后面引号里的那一段。
 *
 * 用后行断言而不是把 from 一起吃进匹配：断言零宽，match.index 仍然落在包名上，
 * 报出来的列号才继续指着出问题的那个字。
 */
const SPECIFIER = String.raw`(?<=(?:from|import)\s*\(?\s*['"])`

const layerRules = Object.entries(layers).map(([layer, { may, native }]) => {
  const allowed = ['foundations', layer, ...may]
  const forbidden = [`${SPECIFIER}@poietica/(?!(?:${allowed.join('|')})-)[\\w-]+`]

  if (!native) {
    forbidden.push(`${SPECIFIER}@tauri-apps/[\\w-]+`)
  }

  return {
    id: `${layer}-depends-downward`,
    appliesTo: inLayer(layer),
    pattern: new RegExp(forbidden.join('|'), 'g'),
    message: `${layer} may depend only on ${allowed.join(', ')}`,
  }
})

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
    pattern: /from\s+['"](?:\.\.\/){2,}(?:agent|apps|editor|features|foundations|platforms)\//g,
    message: 'relative imports must not cross top-level package boundaries',
  },
  ...layerRules,
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
