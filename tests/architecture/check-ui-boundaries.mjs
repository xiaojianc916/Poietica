#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')

const sourceRoots = ['apps', 'editor', 'features', 'foundations', 'platforms'].map((directory) =>
  path.join(repositoryRoot, directory),
)

const tldrawCssBoundary = normalize(
  path.join(repositoryRoot, 'editor/core/src/styles/tldraw-adapter.css'),
)

const designSystemRoot = normalize(path.join(repositoryRoot, 'foundations/design-system'))

const violations = []

for (const sourceRoot of sourceRoots) {
  for (const filePath of await walk(sourceRoot)) {
    const normalizedPath = normalize(filePath)
    const extension = path.extname(filePath)

    if (extension !== '.ts' && extension !== '.tsx' && extension !== '.css') {
      continue
    }

    const source = await readFile(filePath, 'utf8')

    if (
      (extension === '.ts' || extension === '.tsx') &&
      source.includes('@base-ui/react') &&
      !normalizedPath.startsWith(designSystemRoot)
    ) {
      violations.push({
        filePath,
        message: 'Base UI must be consumed through @hybrid-canvas/design-system.',
      })
    }

    if (
      extension === '.css' &&
      normalizedPath !== tldrawCssBoundary &&
      /\.(?:tl|tlui)-[a-zA-Z0-9_-]+/.test(source)
    ) {
      violations.push({
        filePath,
        message: 'tldraw CSS selectors are only allowed in the tldraw adapter boundary.',
      })
    }

    if (
      extension === '.css' &&
      !normalizedPath.startsWith(designSystemRoot) &&
      /--ui-color-[a-zA-Z0-9_-]+\s*:/.test(source)
    ) {
      violations.push({
        filePath,
        message: 'The deprecated --ui-color-* token family is not allowed.',
      })
    }
  }
}

if (violations.length > 0) {
  console.error('')
  console.error('UI architecture boundary violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${path.relative(repositoryRoot, violation.filePath)}`)
    console.error(`  ${violation.message}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('UI architecture boundaries are valid.')
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
  return filePath.replaceAll('\\\\', '/')
}
