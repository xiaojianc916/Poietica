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
 */
const layers = {
  agent: { may: [], native: false },
  editor: { may: [], native: false },
  features: { may: ['agent', 'editor'], native: false },
  foundations: { may: [], native: false },
  platforms: { may: [], native: true },
}

const layerRules = Object.entries(layers).map(([layer, { may, native }]) => {
  const allowed = ['foundations', layer, ...may]
  const forbidden = [`@poietica/(?!(?:${allowed.join('|')})-)[\\w-]+`]

  if (!native) {
    forbidden.push('@tauri-apps/[\\w-]+')
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
    appliesTo: inDirectory('foundations/design-system/src/components'),
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
