#!/usr/bin/env node
/**
 * The timeline reducer must stay pure and the contract layer must stay free of
 * SDKs, because both are replayed against persisted event logs in tests and in
 * crash recovery. A single import of a runtime here would make replay unfaithful.
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AI_SRC = join(ROOT, 'features', 'ai', 'src')

const failures = []

const BANNED_IN_CONTRACTS_AND_DOMAIN = [
  { pattern: /from '(ai|@ai-sdk\/[^']+)'/, reason: 'AI SDK is not a transport in this codebase' },
  { pattern: /from 'streamdown'/, reason: 'rendering libraries belong to presentation' },
  { pattern: /from '@tauri-apps\//, reason: 'platform access belongs to adapters' },
  { pattern: /from 'react'/, reason: 'contracts and domain must stay framework free' },
]

const REDUCER_ALLOWED_IMPORT = /^\.\.\/contracts\//

async function collect(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(full)))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = [
  ...(await collect(join(AI_SRC, 'contracts'))),
  ...(await collect(join(AI_SRC, 'domain'))),
]

for (const file of files) {
  const source = await readFile(file, 'utf8')
  const rel = relative(ROOT, file)
  if (rel.includes('__tests__')) continue

  for (const rule of BANNED_IN_CONTRACTS_AND_DOMAIN) {
    if (rule.pattern.test(source)) failures.push(rel + ': ' + rule.reason)
  }
}

const reducer = join(AI_SRC, 'domain', 'timeline-reducer.ts')
if (existsSync(reducer)) {
  const source = await readFile(reducer, 'utf8')
  for (const match of source.matchAll(/from '([^']+)'/g)) {
    const specifier = match[1]
    if (!REDUCER_ALLOWED_IMPORT.test(specifier)) {
      failures.push('features/ai/src/domain/timeline-reducer.ts: illegal import ' + specifier)
    }
  }
  if (/Date\.now\(|Math\.random\(|globalThis|window\./.test(source)) {
    failures.push('features/ai/src/domain/timeline-reducer.ts: reducer must be deterministic')
  }
}

if (failures.length > 0) {
  console.error('AI timeline purity check failed:')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}

console.log('AI timeline purity check passed')
