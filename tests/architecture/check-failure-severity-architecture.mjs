#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const requiredFiles = [
  'foundations/kernel/src/failure-policy.ts',
  'foundations/kernel/src/failure-policy.test.ts',
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/application/failures/failure-runtime.test.ts',
  'apps/desktop/src/presentation/ui/ui-feedback.tsx',
  'docs/adr/ADR-007-application-failure-severity.md',
]

for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push(`Missing failure severity artifact: ${relativePath}`)
  }
}

if (failures.length === 0) {
  const policy = read('foundations/kernel/src/failure-policy.ts')

  const runtime = read('apps/desktop/src/application/failures/failure-runtime.ts')

  const feedback = read('apps/desktop/src/presentation/ui/ui-feedback.tsx')

  const fatalRuntime = read('apps/desktop/src/fatal/fatal-runtime.ts')

  for (const impact of [
    'recoverable',
    'feature-degraded',
    'document-fatal',
    'application-fatal',
    'native-fatal',
  ]) {
    requireText(policy, `'${impact}'`, `Failure policy is missing impact ${impact}.`)
  }

  requireText(runtime, 'degradedFeatures', 'Failure runtime does not own feature degradation.')

  requireText(runtime, 'quarantinedDocuments', 'Failure runtime does not own document quarantine.')

  requireText(
    runtime,
    'isTerminalFailureImpact',
    'Non-terminal runtime does not reject terminal failure impact.',
  )

  requireText(feedback, 'UI_FAILURE_POLICIES', 'UI failures are not centrally classified.')

  requireText(
    feedback,
    'useSyncExternalStore',
    'UI feedback does not consume the failure state machine.',
  )

  forbidText(feedback, 'CustomEvent(', 'UI failure propagation still uses CustomEvent.')

  forbidText(feedback, 'USER_MESSAGES', 'Legacy free-form USER_MESSAGES mapping remains.')

  requireText(
    fatalRuntime,
    'FailureImpact',
    'Fatal impact is disconnected from the canonical failure model.',
  )

  scanProductionSources()
}

if (failures.length > 0) {
  console.error(
    [
      'Failure severity architecture checks failed:',
      ...failures.map((failure) => `- ${failure}`),
    ].join('\n'),
  )

  process.exitCode = 1
} else {
}

function scanProductionSources() {
  for (const relativePath of walk('apps/desktop/src')) {
    if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx')) {
      continue
    }

    if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx')) {
      continue
    }

    const source = read(relativePath)

    if (source.includes('reportUiError')) {
      failures.push(`Legacy reportUiError remains in ${relativePath}.`)
    }

    if (
      source.includes('fatalIncidentController.report(') &&
      relativePath !== 'apps/desktop/src/fatal/fatal-runtime.ts'
    ) {
      failures.push(`Direct fatal controller report remains in ${relativePath}.`)
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

function forbidText(source, forbidden, failure) {
  if (source.includes(forbidden)) {
    failures.push(failure)
  }
}
