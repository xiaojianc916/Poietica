#!/usr/bin/env node

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

  requireText(
    feedback,
    "entry.failure.impact !==\n          'document-fatal'",
    'Document fatal failures are still rendered as toast.',
  )

  requireText(
    workspace,
    'sessionId={sessionId}',
    'Document isolation surface does not receive its session identity.',
  )

  requireText(
    workspace,
    'failureRuntime.resolveScope({',
    'Closed documents do not clear quarantine ownership.',
  )
}

if (failures.length > 0) {
  console.error(
    [
      'Failure presentation hierarchy checks failed:',
      ...failures.map((failure) => '- ' + failure),
    ].join('\n'),
  )

  process.exitCode = 1
} else {
  console.log('Failure presentation hierarchy checks passed.')
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
