#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const componentRoot = path.join(repositoryRoot, 'foundations/design-system/src/components')

const forbiddenTokens = [
  {
    token: 'h-8',
    replacement: 'h-[var(--ui-control-height-sm)]',
  },
  {
    token: 'h-9',
    replacement: 'h-[var(--ui-control-height-md)]',
  },
  {
    token: 'h-10',
    replacement: 'h-[var(--ui-control-height-lg)]',
  },
  {
    token: 'w-9',
    replacement: 'w-[var(--ui-control-height-md)]',
  },
  {
    token: 'duration-150',
    replacement: 'duration-[var(--ui-duration-fast)]',
  },
  {
    token: 'z-50',
    replacement: 'z-[var(--ui-z-popover)]',
  },
  {
    token: 'shadow-2xl',
    replacement: 'shadow-[var(--ui-shadow-xl)]',
  },
]

const violations = []

for (const filePath of await walk(componentRoot)) {
  const extension = path.extname(filePath)

  if (extension !== '.ts' && extension !== '.tsx') {
    continue
  }

  const source = await readFile(filePath, 'utf8')

  for (const rule of forbiddenTokens) {
    const expression = new RegExp(`(?<![a-zA-Z0-9_-])${escapeRegExp(rule.token)}(?![a-zA-Z0-9_-])`)

    if (expression.test(source)) {
      violations.push({
        filePath,
        token: rule.token,
        replacement: rule.replacement,
      })
    }
  }
}

if (violations.length > 0) {
  console.error('')
  console.error('Design token consumption violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${path.relative(repositoryRoot, violation.filePath)}`)

    console.error(`  Replace ${violation.token} with ${violation.replacement}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Design-system token consumption is valid.')
}

async function walk(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  })

  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function escapeRegExp(value) {
  return value
}
