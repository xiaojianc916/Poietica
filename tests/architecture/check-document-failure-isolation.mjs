#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stderr. */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  host: 'editor/core/src/react/EditorSessionHost.tsx',

  reporter: 'apps/desktop/src/application/failures/document-failure-reporter.ts',

  policy: 'apps/desktop/src/application/failures/failure-policy.ts',

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

  const policy = read(files.policy)

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

  /*
   * The reporter owns translation from an editor-session
   * failure into the canonical application failure code.
   *
   * It must not duplicate severity, recovery or scope policy.
   */
  requireText(
    reporter,
    "reportFailure('DOCUMENT_EDITOR_SESSION_FATAL'",
    'Editor session failures are not routed through the canonical document failure policy.',
  )

  requireText(
    reporter,
    'sessionId: failure.sessionId',
    'Editor session failure does not provide document scope identity.',
  )

  const documentPolicy = readPolicyEntry(policy, 'DOCUMENT_EDITOR_SESSION_FATAL')

  requireText(
    documentPolicy,
    "impact: 'document-fatal'",
    'DOCUMENT_EDITOR_SESSION_FATAL is not classified as document-fatal.',
  )

  requireText(
    documentPolicy,
    "recovery: 'close-document'",
    'DOCUMENT_EDITOR_SESSION_FATAL recovery is not close-document.',
  )

  requireText(
    documentPolicy,
    'scope: requireDocumentScope',
    'DOCUMENT_EDITOR_SESSION_FATAL does not require document scope.',
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

  forbidText(
    reporter,
    "impact: 'document-fatal'",
    'Document failure reporter duplicates impact policy instead of using failure-policy.ts.',
  )

  forbidText(
    reporter,
    "recovery: 'close-document'",
    'Document failure reporter duplicates recovery policy instead of using failure-policy.ts.',
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
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function readPolicyEntry(source, code) {
  const startMarker = `${code}: {`

  const startIndex = source.indexOf(startMarker)

  if (startIndex < 0) {
    failures.push(`Failure policy is missing ${code}.`)

    return ''
  }

  const endMarker = '\n  },'

  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length)

  if (endIndex < 0) {
    failures.push(`Unable to determine the ${code} policy boundary.`)

    return ''
  }

  return source.slice(startIndex, endIndex + endMarker.length)
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
