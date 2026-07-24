#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  policy: 'apps/desktop/src/application/failures/failure-policy.ts',

  coordinator: 'apps/desktop/src/application/failures/failure-coordinator.ts',

  titleBar: 'apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx',

  appShell: 'apps/desktop/src/presentation/AppShell.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',
}

for (const relativePath of Object.values(files)) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push(`Missing feature degradation file: ${relativePath}`)
  }
}

if (failures.length === 0) {
  const policy = read(files.policy)

  const coordinator = read(files.coordinator)

  const titleBar = read(files.titleBar)

  const appShell = read(files.appShell)

  const workspace = read(files.workspace)

  requireText(policy, 'DEGRADABLE_FEATURE_IDS', 'Feature IDs are not centrally defined.')

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

  requireText(workspace, 'windowControlsDisabled', 'Window controls degradation is not enforced.')

  requireText(workspace, 'windowDraggingDisabled', 'Window dragging degradation is not enforced.')

  requireText(titleBar, 'disabled={', 'Window buttons are not disabled.')

  requireText(titleBar, 'windowDraggingDisabled', 'Title bar does not reject degraded dragging.')
}

if (failures.length > 0) {
  console.error(
    ['Feature degradation checks failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'),
  )

  process.exitCode = 1
} else {
  process.stdout.write('Feature degradation checks passed.\n')
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function requireText(source, expected, failure) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}

function forbidText(source, forbidden, failure) {
  if (source.includes(forbidden)) {
    failures.push(failure)
  }
}
