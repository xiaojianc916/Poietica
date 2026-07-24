#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const sourceRoot = 'apps/desktop/src'

const files = {
  runtime: 'apps/desktop/src/fatal/fatal-runtime.ts',
  collectors: 'apps/desktop/src/fatal/fatal-collectors.ts',
  boundary: 'apps/desktop/src/fatal/FatalErrorBoundary.tsx',
  reactRoot: 'apps/desktop/src/bootstrap/react-root.tsx',
  main: 'apps/desktop/src/main.tsx',
}

for (const relativePath of Object.values(files)) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push('Missing fatal escalation policy file: ' + relativePath)
  }
}

if (failures.length === 0) {
  const runtime = read(files.runtime)
  const collectors = read(files.collectors)
  const boundary = read(files.boundary)
  const reactRoot = read(files.reactRoot)
  const main = read(files.main)

  requireText(
    runtime,
    'export type FatalEscalationImpact =',
    'Fatal escalation impact type is missing.',
  )

  requireText(runtime, "| 'application-fatal'", 'Application-fatal impact is missing.')

  requireText(runtime, "| 'native-fatal'", 'Native-fatal impact is missing.')

  requireText(
    runtime,
    'export function reportFatalIncident(',
    'Fatal escalation gateway is missing.',
  )

  requireText(
    runtime,
    'failureImpact: impact',
    'Fatal incidents do not preserve their escalation impact.',
  )

  requireText(
    collectors,
    "impact: 'application-fatal'",
    'Global browser collectors do not declare application-fatal impact.',
  )

  requireText(
    boundary,
    "impact: 'application-fatal'",
    'React root boundary does not declare application-fatal impact.',
  )

  requireText(
    reactRoot,
    "impact: 'application-fatal'",
    'Runtime construction failure does not declare application-fatal impact.',
  )

  requireText(
    main,
    "impact: 'native-fatal'",
    'Previous native crash does not declare native-fatal impact.',
  )

  findDirectControllerReports()
}

if (failures.length > 0) {
  console.error(
    ['Fatal escalation policy checks failed:', ...failures.map((failure) => '- ' + failure)].join(
      '\n',
    ),
  )

  process.exitCode = 1
} else {
  console.log('Fatal escalation policy checks passed.')
}

function findDirectControllerReports() {
  const allowed = new Set([
    'apps/desktop/src/fatal/fatal-runtime.ts',
    'apps/desktop/src/fatal/fatal-controller.ts',
  ])

  for (const relativePath of walk(sourceRoot)) {
    if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx')) {
      continue
    }

    if (
      relativePath.endsWith('.test.ts') ||
      relativePath.endsWith('.test.tsx') ||
      allowed.has(relativePath)
    ) {
      continue
    }

    const source = read(relativePath)

    if (source.includes('fatalIncidentController.report(')) {
      failures.push(
        [
          'Direct fatal controller report is forbidden:',
          relativePath + '.',
          'Use reportFatalIncident with an explicit impact.',
        ].join(' '),
      )
    }
  }
}

function walk(relativeDirectory) {
  const result = []

  for (const entry of readdirSync(path.join(ROOT, relativeDirectory), { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)

    if (entry.isDirectory()) {
      result.push(...walk(relativePath))
      continue
    }

    result.push(relativePath)
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
