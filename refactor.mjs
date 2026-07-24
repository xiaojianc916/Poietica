#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const root = process.cwd()
const packageJsonPath = path.join(root, 'package.json')
const gitignorePath = path.join(root, '.gitignore')

const iconPath = 'apps/desktop/src-tauri/icons/icon.ico'

const requiredRules = [
  '# Tauri 应用图标是源码资产，必须纳入版本控制。',
  '!apps/desktop/src-tauri/icons/',
  '!apps/desktop/src-tauri/icons/**',
]

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
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: root,
      windowsHide: true,
    })

    return {
      ok: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }
  } catch (error) {
    if (!allowFailure) {
      throw new Error(
        [`git ${args.join(' ')} failed`, error.stdout?.trim(), error.stderr?.trim()]
          .filter(Boolean)
          .join('\n'),
      )
    }

    return {
      ok: false,
      stdout: error.stdout?.trim() ?? '',
      stderr: error.stderr?.trim() ?? '',
    }
  }
}

async function main() {
  if (!(await exists(packageJsonPath))) {
    throw new Error(`请在仓库根目录运行脚本。当前目录：${root}`)
  }

  if (!(await exists(gitignorePath))) {
    throw new Error(`找不到 .gitignore：${gitignorePath}`)
  }

  let gitignore = await readFile(gitignorePath, 'utf8')

  const missingRules = requiredRules.filter((rule) => !gitignore.includes(rule))

  if (missingRules.length > 0) {
    gitignore = `${gitignore.trimEnd()}\n\n${missingRules.join('\n')}\n`

    await writeFile(gitignorePath, gitignore, 'utf8')

    console.log('已更新 .gitignore：')
    console.log(missingRules.join('\n'))
  } else {
    console.log('跳过：.gitignore 已包含 Tauri 图标反忽略规则。')
  }

  /*
   * --no-index 用于即使文件已经被 Git 跟踪时，也检查 ignore 规则是否会
   * 匹配该路径。修复成功时，此命令应返回非零且不输出规则。
   */
  const ignored = await git(['check-ignore', '-v', '--no-index', '--', iconPath], true)

  const matchedRule = ignored.stdout.split('\t')[0].split(':').slice(2).join(':')

  if (ignored.ok && !matchedRule.startsWith('!')) {
    throw new Error(
      [
        '修复失败：icon.ico 仍然被普通 ignore 规则匹配。',
        ignored.stdout,
        '请检查 .gitignore 中是否有位于反忽略规则之后的更高优先级规则。',
      ].join('\n'),
    )
  }

  if (ignored.ok && matchedRule.startsWith('!')) {
    console.log('\n验证通过：最后命中的是反忽略规则，icon.ico 已解除忽略。')
  } else {
    console.log('\n验证通过：icon.ico 没有命中任何 ignore 规则。')
  }

  const tracked = await git(['ls-files', '--error-unmatch', '--', iconPath], true)

  if (tracked.ok) {
    console.log('验证通过：icon.ico 当前已被 Git 跟踪。')
  } else {
    console.log(
      ['注意：icon.ico 当前尚未被 Git 跟踪。', '请执行：', `git add -- "${iconPath}"`].join('\n'),
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
