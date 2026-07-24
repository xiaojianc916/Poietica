import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()

const CURRENT_SCRIPT = path.resolve(fileURLToPath(import.meta.url))

const FILES = Object.freeze({
  packageJson: 'package.json',

  gitignore: '.gitignore',

  appShell: 'apps/desktop/src/presentation/AppShell.tsx',

  policy: 'apps/desktop/src/application/failures/failure-policy.ts',

  uiFeedback: 'apps/desktop/src/presentation/ui/ui-feedback.tsx',

  featureAvailability: 'apps/desktop/src/application/failures/feature-availability.ts',

  featureCheck: 'tests/architecture/check-feature-degradation-enforcement.mjs',

  convergenceCheck: 'tests/architecture/check-failure-architecture-convergence.mjs',
})

const DEAD_FILES = [
  FILES.featureAvailability,

  'tests/architecture/check-failure-severity-architecture.mjs',

  'tests/architecture/check-fatal-escalation-policy.mjs',
]

const SUPERSEDED_ADRS = [
  'docs/adr/ADR-005-unified-fatal-incident.md',

  'docs/adr/ADR-006-fatal-escalation-policy.md',

  'docs/adr/ADR-007-application-failure-severity.md',
]

const ROOT_MIGRATION_PATTERNS = [
  /^refactor.*\.mjs$/i,
  /^repair-.*\.mjs$/i,
  /^converge-.*\.mjs$/i,
  /^apply-.*\.mjs$/i,
]

async function main() {
  await assertRepository()

  await removeDeadFiles()
  await removeRootMigrationScripts()

  await centralizeFeatureIds()
  await simplifyAppShell()
  await narrowToastProjection()

  await rewriteFeatureCheck()
  await rewriteConvergenceCheck()

  await markSupersededAdrs()
  await updateGitignore()
  await verifyCleanup()

  console.log('')
  console.log('Failure architecture cleanup completed.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function removeDeadFiles() {
  for (const relativePath of DEAD_FILES) {
    await rm(resolvePath(relativePath), {
      force: true,
    })

    console.log(relativePath + ': removed.')
  }
}

async function removeRootMigrationScripts() {
  const entries = await readdir(ROOT, {
    withFileTypes: true,
  })

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    if (!ROOT_MIGRATION_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      continue
    }

    const absolutePath = path.resolve(ROOT, entry.name)

    if (absolutePath === CURRENT_SCRIPT) {
      console.log(entry.name + ': current script retained locally.')

      continue
    }

    await rm(absolutePath, {
      force: true,
    })

    console.log(entry.name + ': removed.')
  }
}

async function centralizeFeatureIds() {
  const file = resolvePath(FILES.policy)

  let source = await readFile(file, 'utf8')

  if (source.includes('export const DEGRADABLE_FEATURE_IDS')) {
    return
  }

  const marker = 'export const APPLICATION_FAILURE_CODES = ['

  const featureIds = `export const DEGRADABLE_FEATURE_IDS = [
  'settings',
  'developer-tools',
  'window-controls',
  'window-dragging',
  'window-state-sync',
  'window-close-coordination',
] as const

export type DegradableFeatureId =
  (typeof DEGRADABLE_FEATURE_IDS)[number]

`

  source = replaceRequired(source, marker, featureIds + marker, FILES.policy)

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.policy + ': feature IDs centralized.')
}

async function simplifyAppShell() {
  const file = resolvePath(FILES.appShell)

  let source = await readFile(file, 'utf8')

  source = source.replace(
    "import { createFeatureAvailability } from '../application/failures/feature-availability'\n",
    '',
  )

  const oldProjection = `  const featureAvailability = useMemo(
    () => createFeatureAvailability([...failureSnapshot.degradedFeatures.keys()]),
    [failureSnapshot.degradedFeatures],
  )

`

  const directSelectors = `  const settingsUnavailable =
    failureSnapshot.degradedFeatures.has(
      'settings',
    )

  const developerToolsUnavailable =
    failureSnapshot.degradedFeatures.has(
      'developer-tools',
    )

  const windowControlsUnavailable =
    failureSnapshot.degradedFeatures.has(
      'window-controls',
    )

  const windowDraggingUnavailable =
    failureSnapshot.degradedFeatures.has(
      'window-dragging',
    )

`

  source = replaceRequired(source, oldProjection, directSelectors, FILES.appShell)

  source = source.replaceAll("!featureAvailability.isAvailable('settings')", 'settingsUnavailable')

  source = source.replaceAll(
    "!featureAvailability.isAvailable('developer-tools')",
    'developerToolsUnavailable',
  )

  source = source.replaceAll(
    "!featureAvailability.isAvailable('window-controls')",
    'windowControlsUnavailable',
  )

  source = source.replaceAll(
    "!featureAvailability.isAvailable('window-dragging')",
    'windowDraggingUnavailable',
  )

  source = source.replaceAll("featureAvailability.isAvailable('settings')", '!settingsUnavailable')

  source = source.replace(/\[\s*featureAvailability\s*\]/g, '[settingsUnavailable]')

  source = replaceCallbackDependency(
    source,
    '  const minimizeWindow =',
    '  const maximizeWindow =',
    'windowControlsUnavailable',
    FILES.appShell,
  )

  source = replaceCallbackDependency(
    source,
    '  const maximizeWindow =',
    '  const openDeveloperTools =',
    'windowControlsUnavailable',
    FILES.appShell,
  )

  source = replaceCallbackDependency(
    source,
    '  const openDeveloperTools =',
    '  const startWindowDragging =',
    'developerToolsUnavailable',
    FILES.appShell,
  )

  source = replaceCallbackDependency(
    source,
    '  const startWindowDragging =',
    '  useApplicationCommands(',
    'windowDraggingUnavailable',
    FILES.appShell,
  )

  if (source.includes('featureAvailability')) {
    throw new Error('featureAvailability remains in AppShell.')
  }

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.appShell + ': redundant feature projection removed.')
}

async function narrowToastProjection() {
  const source = `import type {
  FailureImpact,
} from '@hybrid-canvas/foundations-kernel'
import {
  DangerCircle,
  X,
} from '@mynaui/icons-react'
import {
  useEffect,
  useSyncExternalStore,
} from 'react'
import {
  failureCoordinator,
  type NonTerminalFailureIncident,
  type PresentedFailure,
} from '../../application/failures/failure-coordinator'

type ToastFailureImpact =
  Extract<
    FailureImpact,
    | 'recoverable'
    | 'feature-degraded'
  >

type ToastIncident =
  NonTerminalFailureIncident & {
    readonly impact:
      ToastFailureImpact
  }

type ToastFailure =
  Omit<
    PresentedFailure,
    'incident'
  > & {
    readonly incident:
      ToastIncident
  }

export function UiFeedbackRegion() {
  const snapshot =
    useSyncExternalStore(
      failureCoordinator.subscribe,
      failureCoordinator.getSnapshot,
      failureCoordinator.getSnapshot,
    )

  const visible =
    selectVisibleFailures([
      ...snapshot.operations,

      ...snapshot
        .degradedFeatures
        .values(),
    ]).slice(-3)

  useEffect(() => {
    const timers =
      visible.map((entry) => {
        const duration =
          entry.incident.impact ===
          'feature-degraded'
            ? 9_000
            : 5_500

        return window.setTimeout(
          () => {
            failureCoordinator.dismiss(
              entry.incident.id,
            )
          },
          duration,
        )
      })

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [visible])

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className={[
        'pointer-events-none',
        'fixed bottom-4 right-4',
        'z-[var(--ui-z-toast)]',
        'grid gap-2',
        'w-[min(380px,calc(100vw-32px))]',
      ].join(' ')}
    >
      {visible.map((entry) => {
        const incident =
          entry.incident

        return (
          <div
            className={[
              'pointer-events-auto',
              'flex items-start gap-3',
              'rounded-lg border',
              incident.impact ===
                'feature-degraded'
                ? 'border-warning/40'
                : 'border-destructive/30',
              'bg-background p-3',
              'text-sm shadow-xl',
            ].join(' ')}
            key={incident.id}
            role="alert"
          >
            <DangerCircle
              aria-hidden="true"
              className={[
                'mt-0.5 size-4',
                'shrink-0',
                incident.impact ===
                  'feature-degraded'
                  ? 'text-warning'
                  : 'text-destructive',
              ].join(' ')}
            />

            <div className="grid min-w-0 flex-1 gap-1">
              <span className="leading-5">
                {
                  incident.userMessage
                }
              </span>

              <span className="text-xs text-muted-foreground">
                {incident.impact ===
                'feature-degraded'
                  ? '功能受限'
                  : '操作失败'}

                {' · '}
                {incident.code}

                {entry.occurrences > 1
                  ? ' · ' +
                    String(
                      entry.occurrences,
                    ) +
                    ' 次'
                  : ''}
              </span>
            </div>

            <button
              aria-label="关闭提示"
              className={[
                'grid size-7',
                'place-items-center',
                'rounded-md',
                'text-muted-foreground',
                'hover:bg-accent',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={() => {
                failureCoordinator.dismiss(
                  incident.id,
                )
              }}
              type="button"
            >
              <X
                aria-hidden="true"
                className="size-3.5"
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function selectVisibleFailures(
  failures:
    readonly PresentedFailure[],
): ToastFailure[] {
  return failures.filter(
    (
      entry,
    ): entry is ToastFailure => {
      if (!entry.noticeVisible) {
        return false
      }

      return (
        entry.incident.impact ===
          'recoverable' ||
        entry.incident.impact ===
          'feature-degraded'
      )
    },
  )
}
`

  await writeFile(resolvePath(FILES.uiFeedback), normalizeText(source), 'utf8')

  console.log(FILES.uiFeedback + ': unreachable branches removed.')
}

async function rewriteFeatureCheck() {
  const source = `#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  policy:
    'apps/desktop/src/application/failures/failure-policy.ts',

  coordinator:
    'apps/desktop/src/application/failures/failure-coordinator.ts',

  titleBar:
    'apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx',

  appShell:
    'apps/desktop/src/presentation/AppShell.tsx',

  workspace:
    'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',
}

for (
  const relativePath of
  Object.values(files)
) {
  if (
    !existsSync(
      path.join(
        ROOT,
        relativePath,
      ),
    )
  ) {
    failures.push(
      'Missing feature degradation file: ' +
        relativePath,
    )
  }
}

if (failures.length === 0) {
  const policy =
    read(files.policy)

  const coordinator =
    read(files.coordinator)

  const titleBar =
    read(files.titleBar)

  const appShell =
    read(files.appShell)

  const workspace =
    read(files.workspace)

  requireText(
    policy,
    'DEGRADABLE_FEATURE_IDS',
    'Feature IDs are not centrally defined.',
  )

  requireText(
    coordinator,
    'degradedFeatures:',
    'Coordinator does not own degraded feature incidents.',
  )

  requireText(
    appShell,
    'failureSnapshot.degradedFeatures.has(',
    'AppShell does not query coordinator feature state directly.',
  )

  forbidText(
    appShell,
    'createFeatureAvailability',
    'Redundant feature availability projection remains.',
  )

  requireText(
    workspace,
    'windowControlsDisabled',
    'Window controls degradation is not enforced.',
  )

  requireText(
    workspace,
    'windowDraggingDisabled',
    'Window dragging degradation is not enforced.',
  )

  requireText(
    titleBar,
    'disabled={',
    'Window buttons are not disabled.',
  )

  requireText(
    titleBar,
    'windowDraggingDisabled',
    'Title bar does not reject degraded dragging.',
  )
}

if (failures.length > 0) {
  console.error(
    [
      'Feature degradation checks failed:',
      ...failures.map(
        (failure) =>
          '- ' + failure,
      ),
    ].join('\\n'),
  )

  process.exitCode = 1
} else {
  process.stdout.write(
    'Feature degradation checks passed.\\n',
  )
}

function read(relativePath) {
  return readFileSync(
    path.join(
      ROOT,
      relativePath,
    ),
    'utf8',
  )
}

function requireText(
  source,
  expected,
  failure,
) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}

function forbidText(
  source,
  forbidden,
  failure,
) {
  if (source.includes(forbidden)) {
    failures.push(failure)
  }
}
`

  await writeFile(resolvePath(FILES.featureCheck), normalizeText(source), 'utf8')
}

async function rewriteConvergenceCheck() {
  const source = `#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const required = [
  'apps/desktop/src/application/failures/failure-coordinator.ts',
  'apps/desktop/src/application/failures/failure-diagnostic.ts',
  'apps/desktop/src/application/failures/failure-policy.ts',
  'apps/desktop/src/application/failures/failure-coordinator.test.ts',
  'apps/desktop/src/fatal/fatal-runtime.ts',
]

const forbiddenFiles = [
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/application/failures/feature-availability.ts',
  'apps/desktop/src/fatal/fatal-controller.ts',
  'apps/desktop/src/fatal/fatal-incident.ts',
  'tests/architecture/check-failure-severity-architecture.mjs',
  'tests/architecture/check-fatal-escalation-policy.mjs',
  'refactor.mjs',
]

for (const file of required) {
  if (
    !existsSync(
      path.join(ROOT, file),
    )
  ) {
    failures.push(
      'Missing unified failure file: ' +
        file,
    )
  }
}

for (const file of forbiddenFiles) {
  if (
    existsSync(
      path.join(ROOT, file),
    )
  ) {
    failures.push(
      'Obsolete failure artifact remains: ' +
        file,
    )
  }
}

if (failures.length === 0) {
  const coordinator =
    read(required[0])

  requireText(
    coordinator,
    'readonly terminal:',
    'Coordinator does not own terminal state.',
  )

  requireText(
    coordinator,
    'readonly operations:',
    'Coordinator does not own operation failures.',
  )

  requireText(
    coordinator,
    'readonly degradedFeatures:',
    'Coordinator does not own feature degradation.',
  )

  requireText(
    coordinator,
    'readonly quarantinedDocuments:',
    'Coordinator does not own document quarantine.',
  )

  scanProductionSources()
}

if (failures.length > 0) {
  console.error(
    [
      'Failure architecture convergence checks failed:',
      ...failures.map(
        (failure) =>
          '- ' + failure,
      ),
    ].join('\\n'),
  )

  process.exitCode = 1
} else {
  process.stdout.write(
    'Failure architecture convergence checks passed.\\n',
  )
}

function scanProductionSources() {
  for (
    const file of walk(
      'apps/desktop/src',
    )
  ) {
    if (
      !file.endsWith('.ts') &&
      !file.endsWith('.tsx')
    ) {
      continue
    }

    const source = read(file)

    for (
      const forbiddenText of [
        'FatalIncidentController',
        'fatalIncidentController',
        'FailureRuntime',
        'failureRuntime',
        'UI_FAILURE_POLICIES',
        'reportUiFailure',
        'createFeatureAvailability',
      ]
    ) {
      if (
        source.includes(
          forbiddenText,
        )
      ) {
        failures.push(
          'Legacy failure symbol ' +
            forbiddenText +
            ' remains in ' +
            file +
            '.',
        )
      }
    }
  }
}

function walk(relativeDirectory) {
  const result = []

  for (
    const entry of
    readdirSync(
      path.join(
        ROOT,
        relativeDirectory,
      ),
      {
        withFileTypes: true,
      },
    )
  ) {
    const relativePath =
      path.posix.join(
        relativeDirectory,
        entry.name,
      )

    if (entry.isDirectory()) {
      result.push(
        ...walk(relativePath),
      )
    } else {
      result.push(
        relativePath,
      )
    }
  }

  return result
}

function read(relativePath) {
  return readFileSync(
    path.join(
      ROOT,
      relativePath,
    ),
    'utf8',
  )
}

function requireText(
  source,
  expected,
  failure,
) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}
`

  await writeFile(resolvePath(FILES.convergenceCheck), normalizeText(source), 'utf8')
}

async function markSupersededAdrs() {
  for (const relativePath of SUPERSEDED_ADRS) {
    const file = resolvePath(relativePath)

    let source = await readFile(file, 'utf8')

    if (source.includes('\\n')) {
      source = source.replaceAll('\\n', '\n')
    }

    source = source.replace('- Status: Accepted', '- Status: Superseded')

    if (!source.includes('- Superseded by: ADR-011')) {
      source = source.replace(
        '- Status: Superseded',
        ['- Status: Superseded', '- Superseded by: ADR-011'].join('\n'),
      )
    }

    await writeFile(file, normalizeText(source), 'utf8')

    console.log(relativePath + ': marked superseded.')
  }
}

async function updateGitignore() {
  const file = resolvePath(FILES.gitignore)

  let source = await readFile(file, 'utf8')

  const block = `# One-off repository migration scripts
/refactor*.mjs
/repair-*.mjs
/converge-*.mjs
/apply-*.mjs
/cleanup-*.mjs
`

  if (!source.includes('# One-off repository migration scripts')) {
    source = source.trimEnd() + '\n\n' + block
  }

  await writeFile(file, normalizeText(source), 'utf8')
}

async function verifyCleanup() {
  const violations = []

  for (const relativePath of DEAD_FILES) {
    if (await fileExists(resolvePath(relativePath))) {
      violations.push(relativePath + ': still exists')
    }
  }

  const appShell = await readFile(resolvePath(FILES.appShell), 'utf8')

  for (const forbidden of ['createFeatureAvailability', 'featureAvailability']) {
    if (appShell.includes(forbidden)) {
      violations.push(FILES.appShell + ': ' + forbidden)
    }
  }

  const feedback = await readFile(resolvePath(FILES.uiFeedback), 'utf8')

  for (const forbidden of [
    "case 'document-fatal'",
    "case 'application-fatal'",
    "case 'native-fatal'",
  ]) {
    if (feedback.includes(forbidden)) {
      violations.push(FILES.uiFeedback + ': ' + forbidden)
    }
  }

  if (violations.length > 0) {
    throw new Error(
      ['Cleanup verification failed:', ...violations.map((violation) => '- ' + violation)].join(
        '\n',
      ),
    )
  }
}

function replaceCallbackDependency(source, startMarker, endMarker, dependency, file) {
  const startIndex = source.indexOf(startMarker)

  const endIndex = source.indexOf(endMarker, startIndex)

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(['Could not locate callback section in', file + ':', startMarker].join(' '))
  }

  const section = source.slice(startIndex, endIndex)

  const dependencyPattern =
    /\[\s*(?:featureAvailability|windowControlsUnavailable|developerToolsUnavailable|windowDraggingUnavailable),\s*runtime\.mainWindow\s*\]/

  const expected = '[' + dependency + ', runtime.mainWindow]'

  if (!dependencyPattern.test(section)) {
    if (section.includes(expected)) {
      return source
    }

    throw new Error(
      ['Could not locate main-window dependency array in', file + ':', startMarker].join(' '),
    )
  }

  const updatedSection = section.replace(dependencyPattern, expected)

  return source.slice(0, startIndex) + updatedSection + source.slice(endIndex)
}

function replaceRequired(source, oldText, newText, file) {
  if (source.includes(newText)) {
    return source
  }

  if (!source.includes(oldText)) {
    throw new Error('Could not find expected text in ' + file + ': ' + oldText)
  }

  return source.replace(oldText, newText)
}

function replaceNthRequired(source, oldText, newText, occurrence, file) {
  let searchFrom = 0
  let index = -1

  for (let count = 0; count < occurrence; count += 1) {
    index = source.indexOf(oldText, searchFrom)

    if (index === -1) {
      throw new Error(
        'Could not find occurrence ' + String(occurrence) + ' in ' + file + ': ' + oldText,
      )
    }

    searchFrom = index + oldText.length
  }

  return source.slice(0, index) + newText + source.slice(index + oldText.length)
}

async function fileExists(absolutePath) {
  try {
    await readFile(absolutePath, 'utf8')

    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath)
}

main().catch((error) => {
  console.error('')
  console.error('Failure architecture cleanup failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
