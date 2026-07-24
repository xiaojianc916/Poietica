import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDirectory = process.cwd()

const paths = {
  packageJson: resolve(rootDirectory, 'package.json'),
  architectureCheck: resolve(
    rootDirectory,
    'tests/architecture/check-failure-architecture-convergence.mjs',
  ),
  canvasWorkflow: resolve(rootDirectory, 'apps/desktop/src/application/canvas/canvas-workflow.ts'),
  failureCoordinatorTest: resolve(
    rootDirectory,
    'apps/desktop/src/application/failures/failure-coordinator.test.ts',
  ),
  fatalCollectors: resolve(rootDirectory, 'apps/desktop/src/fatal/fatal-collectors.ts'),
}

function writeMessage(message) {
  process.stdout.write(`${message}\n`)
}

function writeError(message) {
  process.stderr.write(`${message}\n`)
}

function exitWithError(message) {
  writeError(`错误：${message}`)
  process.exit(1)
}

function assertFileExists(filePath, displayName) {
  if (!existsSync(filePath)) {
    exitWithError(`未找到 ${displayName}：${filePath}`)
  }
}

function countOccurrences(content, searchText) {
  return content.split(searchText).length - 1
}

function replaceInFile({ filePath, displayName, oldText, newText, expectedCount = 1 }) {
  assertFileExists(filePath, displayName)

  const originalContent = readFileSync(filePath, 'utf8')
  const oldCount = countOccurrences(originalContent, oldText)
  const newCount = countOccurrences(originalContent, newText)

  if (oldCount === 0 && newCount >= expectedCount) {
    writeMessage(`已跳过：${displayName} 已经修复。`)
    return
  }

  if (oldCount !== expectedCount) {
    exitWithError(
      `${displayName} 预期找到 ${expectedCount} 处待修改内容，实际找到 ${oldCount} 处。`,
    )
  }

  const updatedContent = originalContent.replaceAll(oldText, newText)

  writeFileSync(filePath, updatedContent, 'utf8')
  writeMessage(`已修复：${displayName}`)
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

function fixArchitectureCheck() {
  const oldText = `  console.log('Failure architecture convergence checks passed.')`

  const newText = `  process.stdout.write('Failure architecture convergence checks passed.\\n')`

  replaceInFile({
    filePath: paths.architectureCheck,
    displayName: '架构收敛检查输出',
    oldText,
    newText,
  })
}

function fixCanvasReleaseFailure() {
  replaceInFile({
    filePath: paths.canvasWorkflow,
    displayName: 'Canvas release failure 属性',
    oldText: '          failure: result.incident,',
    newText: '          failure: result.failure,',
  })
}

function fixFailureCoordinatorTest() {
  replaceInFile({
    filePath: paths.failureCoordinatorTest,
    displayName: 'FailureCoordinator 测试快照属性',
    oldText: '    expect(coordinator.getSnapshot().incidents).toHaveLength(1)',
    newText: '    expect(coordinator.getSnapshot().failures).toHaveLength(1)',
  })
}

function fixFatalCollectors() {
  const oldInputStart = `  const input: TerminalFailureInput = {
    error:`

  const newInputStart = `  const input: TerminalFailureInput = {
    impact: 'application-fatal',
    error:`

  replaceInFile({
    filePath: paths.fatalCollectors,
    displayName: 'Fatal collector impact 属性',
    oldText: oldInputStart,
    newText: newInputStart,
    expectedCount: 3,
  })

  const oldReportCall = `  const incident = reportFatalIncident({
    ...input,
    impact: 'application-fatal',
  })`

  const newReportCall = '  const incident = reportFatalIncident(input)'

  replaceInFile({
    filePath: paths.fatalCollectors,
    displayName: 'Fatal collector 上报调用',
    oldText: oldReportCall,
    newText: newReportCall,
    expectedCount: 3,
  })
}

assertFileExists(paths.packageJson, 'package.json')

writeMessage('开始修复 Biome 和 TypeScript 错误……')

fixArchitectureCheck()
fixCanvasReleaseFailure()
fixFailureCoordinatorTest()
fixFatalCollectors()

writeMessage('\n正在修复模板字符串……')

run('pnpm exec biome lint --write --unsafe --only=lint/style/useTemplate .')

writeMessage('正在格式化修改的文件……')

run(
  [
    'pnpm exec biome format --write',
    'refactor.mjs',
    'tests/architecture/check-failure-architecture-convergence.mjs',
    'apps/desktop/src/application/canvas/canvas-workflow.ts',
    'apps/desktop/src/application/failures/failure-coordinator.test.ts',
    'apps/desktop/src/application/failures/failure-diagnostic.ts',
    'apps/desktop/src/fatal/fatal-collectors.ts',
    'apps/desktop/src/fatal/fatal-runtime.ts',
    'apps/desktop/src/fatal/pre-react-entry.ts',
  ].join(' '),
)

writeMessage('正在执行完整 lint 验证……')

run('pnpm lint')

writeMessage('正在执行 TypeScript 类型检查……')

run('pnpm typecheck')

writeMessage('\n全部修复完成，lint 和 typecheck 均已通过。')
