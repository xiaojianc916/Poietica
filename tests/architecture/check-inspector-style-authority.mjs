#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const tldrawPath = path.join(repositoryRoot, 'apps/desktop/src/styles/tldraw-overrides.css')

const inspectorPath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/inspector/properties-inspector.css',
)

const inspectorHostPath = path.join(
  repositoryRoot,
  'features/workspace/src/presentation/inspector/InspectorHost.tsx',
)

const tldraw = await readFile(tldrawPath, 'utf8')

const inspector = await readFile(inspectorPath, 'utf8')

const inspectorHost = await readFile(inspectorHostPath, 'utf8')

const violations = []

if (tldraw.includes('.hc-properties-sidebar') || tldraw.includes('.hc-properties-inspector-host')) {
  violations.push('tldraw-overrides.css must not own Workspace inspector styles.')
}

if (tldraw.includes('.tlui-toolbar__tools')) {
  violations.push(
    'Do not override the official tldraw Toolbar radius without an approved requirement.',
  )
}

if (inspector.includes('.tl-') || inspector.includes('.tlui-')) {
  violations.push('properties-inspector.css must not directly target tldraw selectors.')
}

if (!inspectorHost.includes("import './properties-inspector.css'")) {
  violations.push('InspectorHost must import its owned stylesheet.')
}

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

for (const token of requiredTokens) {
  if (!inspector.includes(token)) {
    violations.push(`Inspector stylesheet does not consume ${token}.`)
  }
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
