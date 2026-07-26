#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const required = [
  'apps/desktop/src/application/failures/failure-coordinator.ts',
  'apps/desktop/src/application/failures/failure-diagnostic.ts',
  'apps/desktop/src/fatal/terminal-failure-view-model.ts',
  'apps/desktop/src/fatal/terminal-failure-view-model.test.ts',
  'apps/desktop/src/application/failures/failure-policy.ts',
  'apps/desktop/src/application/failures/failure-coordinator.test.ts',
  'apps/desktop/src/fatal/fatal-runtime.ts',
]

/*
 * Failure machinery that was deleted and must not return.
 *
 * A developer's one-off refactor script does not belong here: .gitignore
 * already guarantees it can never be committed, while this check reads the
 * working tree and would fail on a file git is ignoring.
 */
const forbiddenFiles = [
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/application/failures/feature-availability.ts',
  'apps/desktop/src/fatal/fatal-controller.ts',
  'apps/desktop/src/fatal/fatal-incident.ts',
  'tests/architecture/check-failure-severity-architecture.mjs',
  'tests/architecture/check-fatal-escalation-policy.mjs',
]

for (const file of required) {
  if (!existsSync(path.join(ROOT, file))) {
    failures.push(`Missing unified failure file: ${file}`)
  }
}

for (const file of forbiddenFiles) {
  if (existsSync(path.join(ROOT, file))) {
    failures.push(`Obsolete failure artifact remains: ${file}`)
  }
}

if (failures.length === 0) {
  const coordinator = read(required[0])

  requireText(coordinator, 'readonly terminal:', 'Coordinator does not own terminal state.')

  requireText(coordinator, 'readonly operations:', 'Coordinator does not own operation failures.')

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

  const terminalViewModel = read('apps/desktop/src/fatal/terminal-failure-view-model.ts')

  const reactRenderer = read('apps/desktop/src/fatal/FatalErrorScreen.tsx')

  const preReactRenderer = read('apps/desktop/src/fatal/pre-react-entry.ts')

  requireText(
    terminalViewModel,
    'createTerminalFailureViewModel',
    'Terminal Failure ViewModel factory is missing.',
  )

  requireText(
    reactRenderer,
    'createTerminalFailureViewModel',
    'React Fatal renderer does not consume the canonical ViewModel.',
  )

  requireText(
    preReactRenderer,
    'createTerminalFailureViewModel',
    'Pre-React Fatal renderer does not consume the canonical ViewModel.',
  )

  for (const [rendererName, renderer] of [
    ['React', reactRenderer],
    ['Pre-React', preReactRenderer],
  ]) {
    if (renderer.includes('incident.impact') || renderer.includes('formatFailureDiagnostic')) {
      failures.push(`${rendererName} Terminal renderer bypasses the canonical ViewModel.`)
    }
  }

  if (
    !reactRenderer.includes('createTerminalFailureViewModel') ||
    !preReactRenderer.includes('createTerminalFailureViewModel')
  ) {
    failures.push('Terminal renderers do not share the canonical ViewModel.')
  }

  scanProductionSources()
}

if (failures.length > 0) {
  console.error(
    [
      'Failure architecture convergence checks failed:',
      ...failures.map((failure) => `- ${failure}`),
    ].join('\n'),
  )

  process.exitCode = 1
} else {
  process.stdout.write('Failure architecture convergence checks passed.\n')
}

function scanProductionSources() {
  for (const file of walk('apps/desktop/src')) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) {
      continue
    }

    const source = read(file)

    for (const forbiddenText of [
      'FatalIncidentController',
      'fatalIncidentController',
      'FailureRuntime',
      'failureRuntime',
      'UI_FAILURE_POLICIES',
      'reportUiFailure',
      'createFeatureAvailability',
    ]) {
      if (source.includes(forbiddenText)) {
        failures.push(`Legacy failure symbol ${forbiddenText} remains in ${file}.`)
      }
    }
  }
}

function walk(relativeDirectory) {
  const result = []

  for (const entry of readdirSync(path.join(ROOT, relativeDirectory), {
    withFileTypes: true,
  })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)

    if (entry.isDirectory()) {
      result.push(...walk(relativePath))
    } else {
      result.push(relativePath)
    }
  }

  return result
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function requireText(source, expected, failure) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}
