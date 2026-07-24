#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stderr. */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  surface: 'apps/desktop/src/presentation/workspace/DocumentQuarantineSurface.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  feedback: 'apps/desktop/src/presentation/ui/ui-feedback.tsx',
}

for (const relativePath of Object.values(files)) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push('Missing failure presentation file: ' + relativePath)
  }
}

if (failures.length === 0) {
  const surface = read(files.surface)

  const workspace = read(files.workspace)

  const feedback = read(files.feedback)

  checkDocumentSurface(surface)

  checkToastBoundary(feedback)

  checkQuarantineLifecycle(workspace)
}

if (failures.length > 0) {
  console.error(
    [
      'Failure presentation hierarchy checks failed:',
      ...failures.map((failure) => '- ' + failure),
    ].join('\n'),
  )

  process.exitCode = 1
}

function checkDocumentSurface(surface) {
  requireText(surface, '此画布暂时无法继续', 'Document isolation message is missing.')

  requireText(surface, '其他画布不受影响', 'Document isolation does not explain its limited scope.')

  requireText(surface, '复制诊断信息', 'Document isolation cannot copy diagnostics.')

  requireText(surface, 'size-5', 'Document isolation icon is not restrained.')

  forbidText(surface, 'rounded-lg', 'Document isolation must not use a large card.')

  forbidText(surface, 'rounded-xl', 'Document isolation must not use a large card.')

  forbidText(surface, 'shadow-xl', 'Document isolation must not use a floating card shadow.')

  forbidText(surface, 'shadow-2xl', 'Document isolation must not use a floating card shadow.')

  forbidText(
    surface,
    'bg-destructive/10',
    'Document isolation icon must not use a large warning badge.',
  )
}

function checkToastBoundary(feedback) {
  /*
   * Toast presentation is intentionally built only
   * from recoverable operation failures and degraded
   * feature failures.
   */
  requireText(
    feedback,
    'snapshot.operations',
    'Toast region does not consume recoverable operation failures.',
  )

  requireText(
    feedback,
    'snapshot.degradedFeatures.values()',
    'Toast region does not consume feature-degraded failures.',
  )

  requireText(
    feedback,
    "Extract<FailureImpact, 'recoverable' | 'feature-degraded'>",
    'Toast failure type is not restricted to recoverable and feature-degraded impacts.',
  )

  requireText(
    feedback,
    "entry.incident.impact === 'recoverable'",
    'Toast selector does not explicitly admit recoverable failures.',
  )

  requireText(
    feedback,
    "entry.incident.impact === 'feature-degraded'",
    'Toast selector does not explicitly admit feature-degraded failures.',
  )

  forbidText(
    feedback,
    'snapshot.quarantinedDocuments.values()',
    'Document-fatal quarantine entries are still supplied to the Toast region.',
  )

  forbidText(
    feedback,
    "'document-fatal'",
    'Toast presentation directly references document-fatal failures.',
  )
}

function checkQuarantineLifecycle(workspace) {
  requireText(
    workspace,
    'sessionId={sessionId}',
    'Document isolation surface does not receive its session identity.',
  )

  requireText(
    workspace,
    'failureSnapshot.quarantinedDocuments',
    'Workspace does not observe quarantined documents.',
  )

  requireText(
    workspace,
    'const openSessionIds = new Set(',
    'Workspace does not compute currently open document ownership.',
  )

  requireText(
    workspace,
    'failureCoordinator.resolveScope({',
    'Closed documents do not clear quarantine ownership through the Failure Coordinator.',
  )

  requireText(
    workspace,
    "kind: 'document'",
    'Closed document quarantine cleanup does not use document scope.',
  )

  requireText(
    workspace,
    'documentId: sessionId',
    'Closed document quarantine cleanup does not identify the closed session.',
  )

  requireText(
    workspace,
    'openSessionIds.has(sessionId)',
    'Workspace does not preserve quarantine for documents that remain open.',
  )
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
