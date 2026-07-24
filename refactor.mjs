#!/usr/bin/env node

import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const hooksDirectory = path.join(root, '.githooks')
const preCommitPath = path.join(hooksDirectory, 'pre-commit')

const preCommitHook = `#!/usr/bin/env sh

set -eu

echo "==> pnpm format"
pnpm format

echo "==> Biome 自动格式化"
pnpm exec biome format --write .

echo "==> 暂存格式化结果"
git add -u

echo "==> 提交前格式化完成"
`

async function main() {
  await mkdir(hooksDirectory, { recursive: true })
  await writeFile(preCommitPath, preCommitHook, 'utf8')

  try {
    await chmod(preCommitPath, 0o755)
  } catch {
    // Windows 下由 Git index 的 chmod 标记处理。
  }

  console.log('已修复 .githooks/pre-commit。')
  console.log('已移除 biome check --write，不再在提交时执行全量 lint。')
  console.log('当前流程：pnpm format → biome format --write → git add -u → commit。')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
