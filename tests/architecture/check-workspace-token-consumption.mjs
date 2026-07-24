#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const files = [
  {
    path: path.join(
      repositoryRoot,
      'features/workspace/src/presentation/shell/WorkspaceSidebar.tsx',
    ),
    forbidden: ['text-[9px]', 'text-[10px]', 'text-[11px]'],
  },
  {
    path: path.join(
      repositoryRoot,
      'features/workspace/src/presentation/shell/chrome-workbench-tabs.css',
    ),
    forbidden: [
      'background: #d5803b',
      'background: #2783de',
      'background: #e56458',
      'font-family: -apple-system',
      'transition: color 80ms',
      'transition: opacity 80ms',
      'transition: opacity 100ms',
    ],
  },
]

const violations = []

for (const entry of files) {
  const source = await readFile(entry.path, 'utf8')

  for (const forbidden of entry.forbidden) {
    if (source.includes(forbidden)) {
      violations.push({
        filePath: entry.path,
        forbidden,
      })
    }
  }
}

if (violations.length > 0) {
  console.error('')
  console.error('Workspace token consumption violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${path.relative(repositoryRoot, violation.filePath)}`)

    console.error(`  Forbidden value: ${violation.forbidden}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Workspace token consumption is valid.')
}
