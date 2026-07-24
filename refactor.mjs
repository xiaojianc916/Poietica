#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
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

const PREPARE_COMMAND = 'node scripts/git-hooks/install.mjs'

const preCommitHook = `#!/usr/bin/env sh

set -eu

# 自动暂存格式化结果前，禁止存在未暂存的已跟踪文件改动。
# 这样 git add -u 不会把用户不准备提交的改动混入本次 commit。
if ! git diff --quiet; then
  echo ""
  echo "提交已中止：存在未暂存的已跟踪文件改动。"
  echo "请先暂存、还原或 stash 这些改动，再执行 git commit。"
  echo ""
  git status --short
  exit 1
fi

echo "==> 自动格式化代码"
pnpm format

# pnpm format 的结果必须进入当前正在创建的 commit。
git add -u

echo "==> 格式化完成，格式化结果已自动暂存"
`

const prePushHook = `#!/usr/bin/env sh

set -eu

echo "==> 检查代码格式"
pnpm format:check

echo "==> 静态检查"
pnpm lint

echo "==> TypeScript 类型检查"
pnpm typecheck

echo "==> 架构检查"
pnpm test:architecture

echo ""
echo "==> pre-push 检查通过"
`

const installerScript = `#!/usr/bin/env node

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

  const currentHooksPath = await git(
    ['config', '--get', 'core.hooksPath'],
    true,
  )

  if (
    currentHooksPath.ok &&
    currentHooksPath.stdout &&
    currentHooksPath.stdout !== hooksPath
  ) {
    console.warn(
      [
        '保留已有 core.hooksPath：' + currentHooksPath.stdout,
        '如需使用本仓库 Hook，请手动执行：',
        'git config core.hooksPath ' + hooksPath,
      ].join('\\n'),
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
`

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
        [`git ${args.join(' ')} 执行失败`, error.stdout?.trim(), error.stderr?.trim()]
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

async function ensureRepository() {
  if (!(await exists(packageJsonPath))) {
    throw new Error(`请在仓库根目录执行。未找到：${packageJsonPath}`)
  }

  const gitRoot = await git(['rev-parse', '--show-toplevel'], true)

  if (!gitRoot.ok) {
    throw new Error('当前目录不是 Git 仓库。')
  }

  if (path.resolve(gitRoot.stdout) !== path.resolve(root)) {
    throw new Error(
      [
        '请在 Git worktree 根目录执行脚本。',
        `当前目录：${root}`,
        `仓库根目录：${gitRoot.stdout}`,
      ].join('\n'),
    )
  }
}

async function updatePackageJson() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  packageJson.scripts ??= {}

  const currentPrepare = packageJson.scripts.prepare

  if (!currentPrepare) {
    packageJson.scripts.prepare = PREPARE_COMMAND
    console.log(`已新增 package.json scripts.prepare：${PREPARE_COMMAND}`)
  } else if (!currentPrepare.includes(PREPARE_COMMAND)) {
    packageJson.scripts.prepare = `${currentPrepare} && ${PREPARE_COMMAND}`

    console.log(`已保留原 prepare，并追加 Git Hook 安装：${packageJson.scripts.prepare}`)
  } else {
    console.log('跳过 package.json：prepare 已包含 Git Hook 安装。')
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
}

async function writeHook(filePath, content) {
  await writeFile(filePath, content, 'utf8')

  /*
   * Windows 上 Git Hook 通常可直接由 Git Bash 执行；
   * Unix/macOS clone 后仍需要可执行权限。
   */
  try {
    await chmod(filePath, 0o755)
  } catch {
    // Windows 文件系统不支持 Unix mode 时由 Git index 的 chmod 处理。
  }
}

async function configureHooksPath() {
  const current = await git(['config', '--get', 'core.hooksPath'], true)

  /*
   * 不破坏用户已有的其他 Hook 管理器配置。
   */
  if (current.ok && current.stdout && current.stdout !== '.githooks') {
    throw new Error(
      [
        `检测到已有 core.hooksPath：${current.stdout}`,
        '脚本不会覆盖已有 Hook 配置。',
        '如确认要使用本仓库 Hook，请手动执行：',
        'git config core.hooksPath .githooks',
      ].join('\n'),
    )
  }

  await git(['config', 'core.hooksPath', '.githooks'])
}

async function main() {
  await ensureRepository()

  await mkdir(hooksDirectory, { recursive: true })
  await mkdir(path.dirname(installerPath), { recursive: true })

  await writeHook(preCommitPath, preCommitHook)
  await writeHook(prePushPath, prePushHook)
  await writeFile(installerPath, installerScript, 'utf8')

  await updatePackageJson()
  await configureHooksPath()

  console.log('\nGit Hook 已配置完成。')
  console.log('\n执行逻辑：')
  console.log('  git commit → pnpm format → 自动暂存格式化结果 → 创建 commit')
  console.log('  git push   → format:check → lint → typecheck → architecture → 推送')
  console.log('\n请执行以下命令将 Hook 作为仓库文件提交：')
  console.log('git update-index --add --chmod=+x .githooks/pre-commit')
  console.log('git update-index --add --chmod=+x .githooks/pre-push')
}

main().catch((error) => {
  console.error(`\n配置 Git Hook 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
