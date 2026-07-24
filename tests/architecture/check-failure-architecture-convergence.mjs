#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const required = [
  'apps/desktop/src/application/failures/failure-coordinator.ts',
  'apps/desktop/src/application/failures/failure-diagnostic.ts',
  'apps/desktop/src/application/failures/failure-coordinator.test.ts',
  'apps/desktop/src/fatal/fatal-runtime.ts',
]

const forbidden = [
  'apps/desktop/src/application/failures/failure-runtime.ts',
  'apps/desktop/src/fatal/fatal-controller.ts',
  'apps/desktop/src/fatal/fatal-incident.ts',
]

for (const file of required) {
  if (!existsSync(path.join(ROOT, file))) {
    failures.push('Missing unified failure file: ' + file)
  }
}

for (const file of forbidden) {
  if (existsSync(path.join(ROOT, file))) {
    failures.push('Legacy parallel failure system remains: ' + file)
  }
}

if (failures.length === 0) {
  const coordinator = read(required[0])

  requireText(coordinator, 'readonly terminal:', 'Coordinator does not own terminal state.')

  requireText(coordinator, 'readonly failures:', 'Coordinator does not own recoverable state.')

  requireText(
    coordinator,
    'readonly degradedFeatures:',
    'Coordinator does not own feature degradation.',
  )

  requireText(
    coordinator,
    'readonly quarantinedDocuments:',
    'Coordinator does not own document isolation.',
  )

  scanProductionSources()
}

if (failures.length > 0) {
  console.error(
    [
      'Failure architecture convergence checks failed:',
      ...failures.map((failure) => '- ' + failure),
    ].join('\n'),
  )

  process.exitCode = 1
} else {
  console.log('Failure architecture convergence checks passed.')
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
      'ClassifiedFailure',
    ]) {
      if (source.includes(forbiddenText)) {
        failures.push('Legacy failure symbol ' + forbiddenText + ' remains in ' + file + '.')
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
