#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const root = process.cwd()
const hooksPath = '.githooks'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function git(args, allowFailure = false) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      windowsHide: true,
    })

    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    if (!allowFailure) {
      throw error
    }

    return {
      ok: false,
      stdout: error.stdout?.trim() ?? '',
    }
  }
}

async function main() {
  if (process.env.CI) {
    console.log('跳过 Git hook 安装：当前为 CI 环境。')
    return
  }

  if (!(await exists(path.join(root, 'package.json')))) {
    throw new Error('请在仓库根目录执行 pnpm install。')
  }

  if (!(await exists(path.join(root, hooksPath, 'pre-commit')))) {
    throw new Error('缺少 .githooks/pre-commit。')
  }

  if (!(await exists(path.join(root, hooksPath, 'pre-push')))) {
    throw new Error('缺少 .githooks/pre-push。')
  }

  const gitRoot = await git(['rev-parse', '--show-toplevel'], true)

  if (!gitRoot.ok) {
    console.log('跳过 Git hook 安装：当前目录不是 Git worktree。')
    return
  }

  const currentHooksPath = await git(['config', '--get', 'core.hooksPath'], true)

  if (currentHooksPath.ok && currentHooksPath.stdout && currentHooksPath.stdout !== hooksPath) {
    console.warn(
      [
        '保留已有 core.hooksPath：' + currentHooksPath.stdout,
        '如需使用本仓库 Hook，请手动执行：',
        'git config core.hooksPath ' + hooksPath,
      ].join('\n'),
    )
    return
  }

  await git(['config', 'core.hooksPath', hooksPath])

  console.log('已启用仓库 Git hooks：' + hooksPath)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
