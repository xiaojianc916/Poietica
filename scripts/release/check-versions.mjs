#!/usr/bin/env node
/**
 * Fails when the release version drifts between the four places that declare it.
 * The Cargo workspace is the single source of truth.
 */

import { readFile } from 'node:fs/promises'
import process from 'node:process'

function cargoWorkspaceVersion(toml) {
  const section = toml.split(/^\[workspace\.package\]$/m)[1]
  const match = section?.match(/^version\s*=\s*"([^"]+)"/m)
  return match?.[1] ?? null
}

const [cargoToml, rootPkg, appPkg, tauriConf] = await Promise.all([
  readFile('Cargo.toml', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('apps/desktop/package.json', 'utf8'),
  readFile('apps/desktop/src-tauri/tauri.conf.json', 'utf8'),
])

const expected = cargoWorkspaceVersion(cargoToml)
if (!expected) {
  console.error('Could not read [workspace.package] version from Cargo.toml')
  process.exit(2)
}

const found = [
  ['Cargo.toml [workspace.package]', expected],
  ['package.json', JSON.parse(rootPkg).version],
  ['apps/desktop/package.json', JSON.parse(appPkg).version],
  ['tauri.conf.json', JSON.parse(tauriConf).version],
]

const drifted = found.filter(([, version]) => version !== expected)
for (const [where, version] of found) {
  console.log(`${version === expected ? 'ok  ' : 'DRIFT'} ${where}: ${version}`)
}

if (drifted.length > 0) {
  console.error(`\nRelease version must be ${expected} everywhere.`)
  process.exit(1)
}
