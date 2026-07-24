#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  host: 'editor/core/src/react/EditorSessionHost.tsx',

  reporter: 'apps/desktop/src/application/failures/document-failure-reporter.ts',

  surface: 'apps/desktop/src/presentation/workspace/DocumentQuarantineSurface.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  coordinator: 'apps/desktop/src/application/failures/failure-coordinator.ts',
}

for (const relativePath of Object.values(files)) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push(`Missing document isolation file: ${relativePath}`)
  }
}

if (failures.length === 0) {
  const host = read(files.host)
  const reporter = read(files.reporter)
  const workspace = read(files.workspace)
  const coordinator = read(files.coordinator)

  requireText(
    host,
    'class EditorSessionBoundary',
    'Editor sessions do not have an independent React boundary.',
  )

  requireText(host, 'onSessionFailure', 'Editor session boundary cannot report ownership.')

  requireText(
    host,
    'quarantinedSessionIds',
    'Editor host does not consume document quarantine state.',
  )

  requireText(
    reporter,
    "impact: 'document-fatal'",
    'Editor session failures are not classified as document-fatal.',
  )

  requireText(
    reporter,
    "recovery: 'close-document'",
    'Document fatal recovery is not close-document.',
  )

  requireText(
    workspace,
    'failureSnapshot.quarantinedDocuments',
    'Workspace does not consume quarantined document state.',
  )

  requireText(
    workspace,
    '<DocumentQuarantineSurface',
    'Workspace does not render the document isolation surface.',
  )

  requireText(
    coordinator,
    'quarantinedDocuments',
    'Failure Coordinator does not own document quarantine.',
  )

  forbidText(
    reporter,
    'reportFatalIncident',
    'Document failure reporter incorrectly escalates to application fatal.',
  )
}

if (failures.length > 0) {
  console.error(
    [
      'Document failure isolation checks failed:',
      ...failures.map((failure) => `- ${failure}`),
    ].join('\n'),
  )

  process.exitCode = 1
} else {
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
