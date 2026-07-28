#!/usr/bin/env node
/**
 * Removes build output and installed dependencies.
 *
 * Node has covered recursive removal since fs.rm, so there is no reason to
 * carry rimraf for it. Walking the tree is also faster than globbing for
 * '**' + '/node_modules': a match is removed whole and never descended into,
 * whereas a glob walks every nested copy looking for more matches.
 */

import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const REMOVABLE = new Set(['node_modules', 'dist', 'target', '.turbo'])
const NEVER_ENTER = new Set(['.git'])

async function sweep(directory) {
  let entries

  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return 0
  }

  let removed = 0

  for (const entry of entries) {
    if (!entry.isDirectory() || NEVER_ENTER.has(entry.name)) {
      continue
    }

    const target = path.join(directory, entry.name)

    if (REMOVABLE.has(entry.name)) {
      await rm(target, { force: true, recursive: true })
      removed += 1
      continue
    }

    removed += await sweep(target)
  }

  return removed
}

const removed = await sweep(process.cwd())

console.log(`Removed ${removed} build and dependency directories.`)
