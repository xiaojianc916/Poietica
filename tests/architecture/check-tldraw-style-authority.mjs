#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const authorityPath = path.join(repositoryRoot, 'editor/core/src/styles/tldraw-adapter.css')

const legacyPath = path.join(repositoryRoot, 'apps/desktop/src/styles/tldraw-overrides.css')

const scanRoots = ['apps', 'editor', 'features', 'foundations', 'platforms'].map((directory) =>
  path.join(repositoryRoot, directory),
)

const violations = []

for (const scanRoot of scanRoots) {
  for (const filePath of await walk(scanRoot)) {
    if (path.extname(filePath) !== '.css') {
      continue
    }

    if (path.resolve(filePath) === path.resolve(authorityPath)) {
      continue
    }

    const source = await readFile(filePath, 'utf8')

    const selectorLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith('/*') &&
          !line.startsWith('*') &&
          !line.startsWith('//') &&
          (line.includes('.tl-') || line.includes('.tlui-')),
      )

    if (selectorLines.length > 0) {
      violations.push(
        `${path.relative(
          repositoryRoot,
          filePath,
        )} targets tldraw selectors outside the canonical adapter.`,
      )
    }
  }
}

try {
  await access(legacyPath)

  violations.push('Legacy Desktop tldraw-overrides.css still exists.')
} catch {
  // Expected: the legacy file no longer exists.
}

const appCssPath = path.join(repositoryRoot, 'apps/desktop/src/app.css')

const appCss = await readFile(appCssPath, 'utf8')

if (!appCss.includes('@import "@poietica/editor-core/tldraw-adapter.css";')) {
  violations.push('Desktop app must consume the Canvas package tldraw adapter export.')
}

const canvasPackagePath = path.join(repositoryRoot, 'editor/core/package.json')

const canvasPackage = JSON.parse(await readFile(canvasPackagePath, 'utf8'))

if (canvasPackage.exports?.['./tldraw-adapter.css'] !== './src/styles/tldraw-adapter.css') {
  violations.push('Canvas package does not export tldraw-adapter.css.')
}

if (violations.length > 0) {
  console.error('')
  console.error('tldraw style authority violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${violation}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('tldraw style authority is valid.')
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
