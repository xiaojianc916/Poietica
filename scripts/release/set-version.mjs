#!/usr/bin/env node
/**
 * 把发布版本一次写进四个声明处。
 *
 * check-versions.mjs 只在漂移之后报错 —— 检测有了，写入没有，于是每次发版都是
 * 手改四个文件再祈祷。这条命令补上另一半：Cargo workspace 仍是唯一真相，其余
 * 三处由它派生。
 *
 *   pnpm version:set 0.2.0
 */

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const version = process.argv[2]

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: pnpm version:set <semver>   e.g. pnpm version:set 0.2.0')
  process.exit(2)
}

async function editJsonVersion(file) {
  const source = await readFile(file, 'utf8')
  const data = JSON.parse(source)
  data.version = version
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

// [workspace.package] 段内的第一个 version 键，逐字替换，不重排 TOML。
const cargo = await readFile('Cargo.toml', 'utf8')
const [head, ...tail] = cargo.split(/^\[workspace\.package\]$/m)

if (tail.length === 0) {
  console.error('Could not find [workspace.package] in Cargo.toml')
  process.exit(2)
}

const body = tail.join('[workspace.package]')
const patched = body.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)

if (patched === body) {
  console.error('Could not find a version key under [workspace.package]')
  process.exit(2)
}

await writeFile('Cargo.toml', `${head}[workspace.package]${patched}`, 'utf8')

await editJsonVersion('package.json')
await editJsonVersion('apps/desktop/package.json')
await editJsonVersion('apps/desktop/src-tauri/tauri.conf.json')

console.log(`version set to ${version} in 4 files; run pnpm check:versions to confirm`)
