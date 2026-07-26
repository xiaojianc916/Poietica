#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

/**
 * Layer discipline for the AI runtime.
 *
 * The reducer is replayed against persisted event logs in tests and in crash
 * recovery, so it must stay pure and deterministic. Contracts stay free of SDKs,
 * adapters stay free of React, and presentation stays free of platform access.
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const aiSource = path.join(repositoryRoot, 'features', 'ai', 'src')

const rules = [
  {
    layer: 'contracts',
    banned: [
      [/from '(ai|@ai-sdk\/[^']+)'/, 'the AI SDK is not a transport in this codebase'],
      [/from 'streamdown'/, 'rendering libraries belong to presentation'],
      [/from '@tanstack\/react-virtual'/, 'virtualisation belongs to presentation'],
      [/from 'react'/, 'contracts must stay framework free'],
      [/from '@tauri-apps\//, 'platform access belongs to the platform layer'],
    ],
  },
  {
    layer: 'domain',
    banned: [
      [/from '(ai|@ai-sdk\/[^']+)'/, 'the AI SDK is not a transport in this codebase'],
      [/from 'streamdown'/, 'rendering libraries belong to presentation'],
      [/from 'react'/, 'domain logic must stay framework free'],
      [/from '@tauri-apps\//, 'platform access belongs to the platform layer'],
    ],
  },
  {
    layer: 'adapters',
    banned: [
      [/from 'react'/, 'adapters must not depend on the view layer'],
      [/from '@tauri-apps\//, 'platform bindings must be injected, not imported'],
    ],
  },
  {
    layer: 'presentation',
    banned: [[/from '@tauri-apps\//, 'presentation must not reach the platform directly']],
  },
]

const failures = []

for (const rule of rules) {
  for (const filePath of await walk(path.join(aiSource, rule.layer))) {
    const relativePath = path.relative(repositoryRoot, filePath)
    if (relativePath.includes('__tests__')) {
      continue
    }

    const source = await readFile(filePath, 'utf8')
    for (const [pattern, reason] of rule.banned) {
      if (pattern.test(source)) {
        failures.push(`${relativePath}: ${reason}`)
      }
    }
  }
}

const reducer = path.join(aiSource, 'domain', 'timeline-reducer.ts')
if (existsSync(reducer)) {
  const source = await readFile(reducer, 'utf8')
  for (const match of source.matchAll(/from '([^']+)'/g)) {
    const specifier = match[1]
    if (!/^\.\.\/contracts\//.test(specifier)) {
      failures.push(`features/ai/src/domain/timeline-reducer.ts: illegal import ${specifier}`)
    }
  }
  if (/Date\.now\(|Math\.random\(|globalThis|window\./.test(source)) {
    failures.push('features/ai/src/domain/timeline-reducer.ts: the reducer must be deterministic')
  }
}

if (failures.length > 0) {
  console.error('')
  console.error('AI runtime layer violations:')
  console.error('')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  console.error('')
  process.exitCode = 1
} else {
  console.log('AI runtime layering is valid.')
}

async function walk(directory) {
  if (!existsSync(directory)) {
    return []
  }
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(entryPath)
    }
  }
  return files
}
