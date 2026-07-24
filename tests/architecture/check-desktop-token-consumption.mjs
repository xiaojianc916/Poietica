#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const repositoryRoot = path.resolve(scriptDirectory, '../..')

const titleBarPath = path.join(
  repositoryRoot,
  'apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx',
)

const appCssPath = path.join(repositoryRoot, 'apps/desktop/src/app.css')

const titleBar = await readFile(titleBarPath, 'utf8')

const appCss = await readFile(appCssPath, 'utf8')

const violations = []

const titleBarForbidden = [
  '#c42b1c',
  '#b3251a',
  'bg-black/5',
  'borderRightWidth: isSidebarOpen ? 1 : 0',
  "'size-8'",
]

for (const forbidden of titleBarForbidden) {
  if (titleBar.includes(forbidden)) {
    violations.push({
      filePath: titleBarPath,
      message: `Platform chrome contains raw visual value: ${forbidden}`,
    })
  }
}

const requiredDesktopTokens = [
  '--desktop-window-control-hover:',
  '--desktop-window-control-active:',
  '--desktop-window-close-hover:',
  '--desktop-window-close-active:',
  '--desktop-window-close-foreground:',
]

for (const requiredToken of requiredDesktopTokens) {
  if (!appCss.includes(requiredToken)) {
    violations.push({
      filePath: appCssPath,
      message: `Missing desktop platform token: ${requiredToken}`,
    })
  }
}

if (appCss.includes('--window-backing-surface: #')) {
  violations.push({
    filePath: appCssPath,
    message: 'Window backing surface must derive from a semantic token.',
  })
}

if (violations.length > 0) {
  console.error('')
  console.error('Desktop token consumption violations:')
  console.error('')

  for (const violation of violations) {
    console.error(`- ${path.relative(repositoryRoot, violation.filePath)}`)

    console.error(`  ${violation.message}`)
  }

  console.error('')
  process.exitCode = 1
} else {
  console.log('Desktop token consumption is valid.')
}
