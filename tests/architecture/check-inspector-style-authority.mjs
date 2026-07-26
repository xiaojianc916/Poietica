#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

/*
 * The Canvas package adapter is the only CSS authority for tldraw selectors.
 * The former Desktop override sheet was deleted, and
 * check-tldraw-style-authority.mjs fails if it ever returns.
 */
const adapterPath = path.join(repositoryRoot, 'editor/core/src/styles/tldraw-adapter.css')

const inspectorPath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/inspector/properties-inspector.css',
)

const inspectorHostPath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/inspector/InspectorHost.tsx',
)

const requiredTokens = [
  '--ui-font-size-xs',
  '--ui-font-size-caption',
  '--ui-font-size-micro',
  '--ui-font-weight-semibold',
  '--ui-region-divider-width',
  '--ui-focus-ring-width',
  '--ui-radius-md',
  '--ui-shadow-sm',
]

const violations = []

const adapter = await readOwnedSource(adapterPath)

const inspector = await readOwnedSource(inspectorPath)

const inspectorHost = await readOwnedSource(inspectorHostPath)

if (adapter !== null) {
  if (
    adapter.includes('.hc-properties-sidebar') ||
    adapter.includes('.hc-properties-inspector-host')
  ) {
    violations.push('The tldraw adapter must not own Workspace inspector styles.')
  }

  if (adapter.includes('.tlui-toolbar__tools')) {
    violations.push(
      'Do not override the official tldraw Toolbar radius without an approved requirement.',
    )
  }
}

if (inspector !== null) {
  if (inspector.includes('.tl-') || inspector.includes('.tlui-')) {
    violations.push('properties-inspector.css must not directly target tldraw selectors.')
  }

  for (const token of requiredTokens) {
    if (!inspector.includes(token)) {
      violations.push(`Inspector stylesheet does not consume ${token}.`)
    }
  }
}

if (inspectorHost !== null && !inspectorHost.includes("import './properties-inspector.css'")) {
  violations.push('InspectorHost must import its owned stylesheet.')
}

if (violations.length > 0) {
  console.error('')
  console.error('Inspector style authority violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${violation}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Inspector style authority is valid.')
}

/**
 * Reads a file this check has an opinion about.
 *
 * A file that has moved or been deleted is a finding, not a crash: the check
 * must be able to say which file it could not read, and the checks that run
 * after it must still get their turn.
 */
async function readOwnedSource(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    violations.push(`Missing file this check owns: ${path.relative(repositoryRoot, filePath)}`)

    return null
  }
}
