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
import {
  ignoredDirectories,
  inventoryRoots,
  rules,
  sourceExtensions,
  sourceRoots,
} from './rules.config.mjs'

const checkDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(checkDirectory, '../..')

const toPosix = (value) => value.replaceAll(path.sep, '/')

/*
 * 一次遍历，两个视图。
 *
 * pattern 规则只看 sourceRoots 下的 .ts/.tsx；check 规则要看 crates 里的 .rs、
 * 目录名和文件体量。上一版让后者住在 rules.config.mjs 的加载期，各走一套遍历、
 * 各带一份忽略名单，而且一 throw 就把 pattern 规则的全部结果掩掉 —— 与本文件
 * 开头那句 "Never short-circuits." 直接冲突。现在遍历一次、汇报一次。
 */
async function collectInventory() {
  const directories = []
  const files = []

  for (const root of inventoryRoots) {
    let entries

    try {
      entries = await readdir(path.join(repositoryRoot, root), {
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
      const absolute = path.join(entry.parentPath, entry.name)
      const entryPath = toPosix(path.relative(repositoryRoot, absolute))

      if (entryPath.split('/').some((segment) => ignoredDirectories.has(segment))) {
        continue
      }

      if (entry.isDirectory()) {
        directories.push(entryPath)
      } else if (entry.isFile()) {
        files.push(entryPath)
      }
    }
  }

  return { directories: directories.sort(), files: files.sort() }
}

function positionOf(source, index) {
  const preceding = source.slice(0, index)
  const lineBreak = preceding.lastIndexOf('\n')

  return { line: preceding.split('\n').length, column: index - lineBreak }
}

const inventory = await collectInventory()

const contents = new Map()

/* 同一个文件只读一次，pattern 规则与 check 规则共用这份缓存。 */
const read = async (file) => {
  if (!contents.has(file)) {
    contents.set(file, await readFile(path.join(repositoryRoot, file), 'utf8'))
  }

  return contents.get(file)
}

const isPatternTarget = (file) =>
  sourceExtensions.has(path.extname(file)) &&
  sourceRoots.some((root) => file.startsWith(`${root}/`))

const violations = []

for (const file of inventory.files.filter(isPatternTarget)) {
  const applicable = rules.filter((rule) => rule.pattern !== undefined && rule.appliesTo(file))

  if (applicable.length === 0) {
    continue
  }

  const source = await read(file)

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
 * check 规则拿到的是同一次遍历的产物，报出来的也进同一个 violations 列表。
 * 判据看的是目录名、清单文件或文件体量时，正则匹配不出位置，行列记 1。
 */
for (const rule of rules) {
  if (rule.check === undefined) {
    continue
  }

  for (const defect of await rule.check({ ...inventory, read })) {
    violations.push({
      file: defect.file,
      line: defect.line ?? 1,
      column: defect.column ?? 1,
      rule: rule.id,
      message: defect.message,
    })
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

/* pattern 与 check 两路汇进来，顺序按文件位置定，输出才是确定的。 */
violations.sort(
  (left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
)

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
