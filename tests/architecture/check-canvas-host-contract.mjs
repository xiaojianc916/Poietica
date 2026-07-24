#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const adapterPath = path.join(repositoryRoot, 'editor/core/src/styles/tldraw-adapter.css')

const workspaceFramePath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/shell/WorkspaceFrame.tsx',
)

const adapter = await readFile(adapterPath, 'utf8')

const workspaceFrame = await readFile(workspaceFramePath, 'utf8')

const violations = []

if (adapter.includes('.workspace-shell')) {
  violations.push('Canvas adapter must not depend on the Workspace implementation class.')
}

if (!adapter.includes('[data-canvas-host]')) {
  violations.push('Canvas adapter must use the explicit Canvas host contract.')
}

if (!workspaceFrame.includes('data-canvas-host="workspace"')) {
  violations.push('WorkspaceFrame must declare itself as a Canvas host.')
}

if (violations.length > 0) {
  console.error('')
  console.error('Canvas host contract violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${violation}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Canvas host contract is valid.')
}
