#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const root = process.cwd()
const packageJsonPath = path.join(root, 'package.json')

const hooksDirectory = path.join(root, '.githooks')
const preCommitPath = path.join(hooksDirectory, 'pre-commit')
const prePushPath = path.join(hooksDirectory, 'pre-push')

const installerPath = path.join(root, 'scripts', 'git-hooks', 'install.mjs')

const prepareCommand = 'node scripts/git-hooks/install.mjs'

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

const installerScript = `#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = process.cwd()

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (process.env.CI) {
    return
  }

  if (!(await exists(path.join(root, '.githooks', 'pre-commit')))) {
    return
  }

  try {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      windowsHide: true,
    })
  } catch {
    return
  }

  await execFileAsync(
    'git',
    ['config', 'core.hooksPath', '.githooks'],
    {
      cwd: root,
      windowsHide: true,
    },
  )

  console.log('已启用 Git Hook：.githooks')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
`

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function git(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    windowsHide: true,
  })

  return stdout.trim()
}

async function ensureRepository() {
  if (!(await exists(packageJsonPath))) {
    throw new Error('请在仓库根目录执行：未找到 package.json。')
  }

  const gitRoot = await git(['rev-parse', '--show-toplevel'])

  if (path.resolve(gitRoot) !== path.resolve(root)) {
    throw new Error(
      ['请在 Git 仓库根目录执行脚本。', `当前目录：${root}`, `仓库根目录：${gitRoot}`].join('\n'),
    )
  }
}

async function updatePackageJson() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  packageJson.scripts ??= {}

  const currentPrepare = packageJson.scripts.prepare

  if (!currentPrepare) {
    packageJson.scripts.prepare = prepareCommand
  } else if (!currentPrepare.includes(prepareCommand)) {
    packageJson.scripts.prepare = `${currentPrepare} && ${prepareCommand}`
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
}

async function main() {
  await ensureRepository()

  await mkdir(hooksDirectory, { recursive: true })
  await mkdir(path.dirname(installerPath), { recursive: true })

  await writeFile(preCommitPath, preCommitHook, 'utf8')
  await writeFile(installerPath, installerScript, 'utf8')

  try {
    await chmod(preCommitPath, 0o755)
  } catch {
    // Windows 下由 Git index 的 chmod 标记处理。
  }

  // 明确删除 pre-push：推送不执行任何检查。
  await rm(prePushPath, { force: true })

  await updatePackageJson()

  // 立即为当前本地仓库启用 Hook。
  await git(['config', 'core.hooksPath', '.githooks'])

  console.log('配置完成。')
  console.log('git commit：pnpm format → biome format → 自动暂存 → 提交')
  console.log('git push：直接推送，不执行 Hook 检查')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
