import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDirectory = process.cwd()
const packageJsonPath = resolve(rootDirectory, 'package.json')
const architectureCheckPath = resolve(
  rootDirectory,
  'tests/architecture/check-failure-architecture-convergence.mjs',
)

function writeMessage(message) {
  process.stdout.write(`${message}\n`)
}

function writeError(message) {
  process.stderr.write(`${message}\n`)
}

function exitWithError(message) {
  writeError(message)
  process.exit(1)
}

function run(commandLine) {
  writeMessage(`\n> ${commandLine}\n`)

  const result = spawnSync(commandLine, {
    cwd: rootDirectory,
    encoding: 'utf8',
    shell: true,
    stdio: 'inherit',
  })

  if (result.error) {
    exitWithError(`命令执行失败：${result.error.message}`)
  }

  if (result.status !== 0) {
    exitWithError(`命令退出，状态码：${result.status ?? 'unknown'}`)
  }
}

function fixArchitectureCheckOutput() {
  if (!existsSync(architectureCheckPath)) {
    exitWithError('未找到 tests/architecture/check-failure-architecture-convergence.mjs')
  }

  const originalContent = readFileSync(architectureCheckPath, 'utf8')

  const oldSuccessOutput = String.raw`  console.log('Failure architecture convergence checks passed.')`
  const newSuccessOutput = String.raw`  process.stdout.write('Failure architecture convergence checks passed.\n')`

  if (originalContent.includes(oldSuccessOutput)) {
    const updatedContent = originalContent.replace(oldSuccessOutput, newSuccessOutput)

    writeFileSync(architectureCheckPath, updatedContent, 'utf8')
    writeMessage('已修复架构检查脚本中的 console.log。')
    return
  }

  if (originalContent.includes(newSuccessOutput)) {
    writeMessage('架构检查脚本已经修复，无需重复修改。')
    return
  }

  exitWithError('架构检查脚本内容与预期不符，请检查该文件是否已经被手动修改。')
}

if (!existsSync(packageJsonPath)) {
  exitWithError('请在 Canvas 仓库根目录运行此脚本。')
}

writeMessage('开始修复 Biome lint 错误……')

fixArchitectureCheckOutput()

writeMessage('正在将字符串拼接修改为模板字符串……')

run('pnpm exec biome lint --write --unsafe --only=lint/style/useTemplate .')

writeMessage('正在格式化本次修改……')

run(
  'pnpm exec biome format --write refactor.mjs tests/architecture/check-failure-architecture-convergence.mjs apps/desktop/src/application/failures/failure-diagnostic.ts apps/desktop/src/fatal/pre-react-entry.ts',
)

writeMessage('正在执行完整 lint 验证……')

run('pnpm lint')

writeMessage('正在执行 TypeScript 类型检查……')

run('pnpm typecheck')

writeMessage('\n全部修复完成，lint 和 typecheck 均已通过。')
