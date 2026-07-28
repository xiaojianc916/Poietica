#!/usr/bin/env node
/* biome-ignore-all lint/suspicious/noConsole: this CLI reports architecture violations. */

/**
 * Architecture checker.
 *
 * One filesystem walk, one read per file, every rule from rules.config.mjs,
 * every violation reported as file:line:column. Never short-circuits.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ignoredDirectories, rules, sourceExtensions, sourceRoots } from './rules.config.mjs'

const checkDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(checkDirectory, '../..')

const toPosix = (value) => value.replaceAll(path.sep, '/')

async function collectSources() {
  const files = []

  for (const sourceRoot of sourceRoots) {
    let entries

    try {
      entries = await readdir(path.join(repositoryRoot, sourceRoot), {
        withFileTypes: true,
        recursive: true,
      })
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue
      }

      throw error
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }

      const absolute = path.join(entry.parentPath, entry.name)
      const file = toPosix(path.relative(repositoryRoot, absolute))

      if (file.split('/').some((segment) => ignoredDirectories.has(segment))) {
        continue
      }

      if (!sourceExtensions.has(path.extname(file))) {
        continue
      }

      files.push(file)
    }
  }

  return files.sort()
}

function positionOf(source, index) {
  const preceding = source.slice(0, index)
  const lineBreak = preceding.lastIndexOf('\n')

  return { line: preceding.split('\n').length, column: index - lineBreak }
}

const violations = []

for (const file of await collectSources()) {
  const applicable = rules.filter((rule) => rule.appliesTo(file))

  if (applicable.length === 0) {
    continue
  }

  const source = await readFile(path.join(repositoryRoot, file), 'utf8')

  for (const rule of applicable) {
    for (const match of source.matchAll(rule.pattern)) {
      const position = positionOf(source, match.index)
      const hint = rule.hint === undefined ? null : rule.hint(match[0])

      violations.push({
        file,
        line: position.line,
        column: position.column,
        rule: rule.id,
        message: hint === null ? rule.message : `${rule.message} (use ${hint})`,
      })
    }
  }
}

/*
 * Task-scoped guards are the failure mode this runner exists to prevent: they
 * encode one migration as a text snapshot, outlive it, and rot without failing.
 * Rules belong in rules.config.mjs.
 */
for (const entry of await readdir(checkDirectory)) {
  if (!entry.startsWith('check-') || !entry.endsWith('.mjs')) {
    continue
  }

  violations.push({
    file: `tests/architecture/${entry}`,
    line: 1,
    column: 1,
    rule: 'no-task-scoped-guards',
    message: 'architecture rules belong in rules.config.mjs, not in a standalone script',
  })
}

if (violations.length === 0) {
  console.log('Architecture rules passed.')
} else {
  console.error('')
  console.error(`Architecture violations (${violations.length}):`)
  console.error('')

  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}:${violation.column}  ${violation.rule}`)
    console.error(`  ${violation.message}`)
  }

  console.error('')
  process.exitCode = 1
}
