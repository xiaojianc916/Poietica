#!/usr/bin/env node
/**
 * 由已构建的 NSIS 产物生成 updater 清单。
 *
 * tauri build 只产出 <installer>.exe 与它的 .sig，latest.json 是 tauri-action
 * 的产物 —— 我们不用那个 action，所以这一步得自己有，而不是没有。
 *
 *   node scripts/release/latest-json.mjs <bundleDir> <outDir> <tag>
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [bundleDir, outDir, tag] = process.argv.slice(2)

if (!bundleDir || !outDir || !tag) {
  console.error('usage: node scripts/release/latest-json.mjs <bundleDir> <outDir> <tag>')
  process.exit(2)
}

const entries = await readdir(bundleDir)
const installer = entries.find((name) => name.endsWith('-setup.exe'))

if (!installer) {
  console.error(`No *-setup.exe under ${bundleDir}`)
  process.exit(1)
}

const signaturePath = path.join(bundleDir, `${installer}.sig`)
let signature

try {
  signature = (await readFile(signaturePath, 'utf8')).trim()
} catch {
  console.error(
    `Missing ${signaturePath}. Build with pnpm build:release and TAURI_SIGNING_PRIVATE_KEY set.`,
  )
  process.exit(1)
}

const manifest = {
  version: tag.replace(/^v/, ''),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/xiaojianc916/poietica/releases/download/${tag}/${encodeURIComponent(installer)}`,
    },
  },
}

await writeFile(path.join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`latest.json written for ${installer}`)
