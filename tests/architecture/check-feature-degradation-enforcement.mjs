#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  policy: 'apps/desktop/src/application/failures/feature-availability.ts',

  titleBar: 'apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx',

  appShell: 'apps/desktop/src/presentation/AppShell.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',
}

for (const relativePath of Object.values(files)) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push('Missing feature degradation file: ' + relativePath)
  }
}

if (failures.length === 0) {
  const policy = read(files.policy)

  const titleBar = read(files.titleBar)

  const appShell = read(files.appShell)

  const workspace = read(files.workspace)

  requireText(policy, 'createFeatureAvailability', 'Feature availability policy is missing.')

  requireText(
    appShell,
    'failureSnapshot.degradedFeatures',
    'AppShell does not consume degraded feature state.',
  )

  requireText(appShell, "'settings'", 'Settings degradation is not enforced.')

  requireText(appShell, "'developer-tools'", 'Developer tools degradation is not enforced.')

  requireText(
    workspace,
    'windowControlsDisabled',
    'Workspace does not enforce degraded window controls.',
  )

  requireText(
    workspace,
    'windowDraggingDisabled',
    'Workspace does not enforce degraded window dragging.',
  )

  requireText(titleBar, 'disabled={', 'Window buttons are not actually disabled.')

  requireText(titleBar, 'windowDraggingDisabled', 'Title bar does not reject degraded dragging.')

  requireOrdering(
    workspace,
    'const workbench = useSyncExternalStore(',
    'useEffect(() => {',
    'Workspace workbench must be declared before the quarantine cleanup effect.',
  )
}

if (failures.length > 0) {
  console.error(
    ['Feature degradation checks failed:', ...failures.map((failure) => '- ' + failure)].join('\n'),
  )

  process.exitCode = 1
} else {
  console.log('Feature degradation checks passed.')
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function requireText(source, expected, failure) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}

function requireOrdering(source, first, second, failure) {
  const firstIndex = source.indexOf(first)

  const secondIndex = source.indexOf(second)

  if (firstIndex === -1 || secondIndex === -1 || firstIndex > secondIndex) {
    failures.push(failure)
  }
}
