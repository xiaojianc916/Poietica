#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const layoutPath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/shell/workspace-layout.ts',
)

const framePath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/shell/WorkspaceFrame.tsx',
)

const layout = await readFile(layoutPath, 'utf8')

const frame = await readFile(framePath, 'utf8')

const violations = []

const requiredLayoutTokens = ['layoutDurationSeconds:', 'layoutEase:']

for (const token of requiredLayoutTokens) {
  if (!layout.includes(token)) {
    violations.push(`workspace-layout.ts is missing ${token}`)
  }
}

const requiredConsumers = [
  'WORKSPACE_LAYOUT.motion.layoutDurationSeconds',
  'WORKSPACE_LAYOUT.motion.layoutEase',
]

for (const consumer of requiredConsumers) {
  if (!frame.includes(consumer)) {
    violations.push(`WorkspaceFrame.tsx is missing ${consumer}`)
  }
}

const forbiddenFrameValues = ['duration: 0.22', 'ease: [0.2, 0, 0, 1]']

for (const forbidden of forbiddenFrameValues) {
  if (frame.includes(forbidden)) {
    violations.push(`WorkspaceFrame.tsx contains raw layout motion value: ${forbidden}`)
  }
}

if (violations.length > 0) {
  console.error('')
  console.error('Workspace motion contract violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${violation}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Workspace motion contract is valid.')
}
