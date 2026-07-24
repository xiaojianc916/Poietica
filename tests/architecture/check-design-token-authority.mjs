#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const tokenDirectory = normalize(
  path.join(repositoryRoot, 'foundations/design-system/src/styles/tokens'),
)

const scanRoots = ['apps', 'editor', 'features', 'foundations', 'platforms'].map((directory) =>
  path.join(repositoryRoot, directory),
)

const violations = []

for (const scanRoot of scanRoots) {
  for (const filePath of await walk(scanRoot)) {
    const extension = path.extname(filePath)

    if (extension !== '.css' && extension !== '.ts' && extension !== '.tsx') {
      continue
    }

    const normalizedPath = normalize(filePath)

    const source = await readFile(filePath, 'utf8')

    if (/--ui-color-[a-zA-Z0-9_-]+\s*:/.test(source)) {
      violations.push({
        filePath,
        message: 'Deprecated --ui-color-* token declaration.',
      })
    }

    if (extension === '.css' && !normalizedPath.startsWith(tokenDirectory)) {
      const declarations = source.match(/--ui-[a-zA-Z0-9_-]+\s*:/g) ?? []

      if (declarations.length > 0) {
        violations.push({
          filePath,
          message:
            'Canonical --ui-* tokens may only be declared in design-system/src/styles/tokens.',
        })
      }
    }
  }
}

if (violations.length > 0) {
  console.error('')
  console.error('Design token authority violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${path.relative(repositoryRoot, violation.filePath)}`)

    console.error(`  ${violation.message}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Design token authority is valid.')
}

async function walk(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  })

  const files = []

  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'target' ||
      entry.name === '.turbo'
    ) {
      continue
    }

    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function normalize(filePath) {
  return filePath.replaceAll('\\', '/')
}
