/**
 * Architecture rules — data, not programs.
 *
 * Every rule is a regular expression evaluated against production source files.
 * Adding a rule means adding an object here; it never means adding a script.
 */

export const sourceRoots = ['apps', 'editor', 'features', 'foundations', 'platforms']

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

const inLayer = (layer) => (file) => isProductionSource(file) && file.startsWith(layer + '/')

const inDirectory = (directory) => (file) =>
  isProductionSource(file) && file.startsWith(directory + '/')

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
    pattern: /from\s+['"](?:\.\.\/){2,}(?:apps|editor|features|foundations|platforms)\//g,
    message: 'relative imports must not cross top-level package boundaries',
  },
  {
    id: 'foundations-are-leaves',
    appliesTo: inLayer('foundations'),
    pattern:
      /@poietica\/(?:asset|canvas|desktop(?:-ipc)?|document|file|platforms-desktop-runtime|plugin|settings|workspace)(?:['"]|\/)/g,
    message: 'foundations must not depend on higher-level packages',
  },
  {
    id: 'editor-is-host-agnostic',
    appliesTo: inLayer('editor'),
    pattern: /@poietica\/(?:desktop|desktop-ipc|platforms-desktop-runtime|workspace)(?:['"]|\/)/g,
    message: 'editor must not depend on application, workspace, or desktop runtime packages',
  },
  {
    id: 'features-are-platform-agnostic',
    appliesTo: inLayer('features'),
    pattern:
      /(?:@tauri-apps\/|@poietica\/(?:desktop|desktop-ipc|platforms-desktop-runtime)(?:['"]|\/))/g,
    message: 'features must not depend directly on Tauri or desktop runtime packages',
  },
  {
    id: 'platforms-below-application',
    appliesTo: inLayer('platforms'),
    pattern: /@poietica\/desktop(?:['"]|\/)/g,
    message: 'platform packages must not depend on application entry packages',
  },
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
