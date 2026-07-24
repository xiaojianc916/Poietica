import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const changedFiles = []

function read(relativePath) {
  const filePath = resolve(root, relativePath)

  if (!existsSync(filePath)) {
    throw new Error(`找不到文件：${relativePath}`)
  }

  return {
    relativePath,
    filePath,
    original: readFileSync(filePath, 'utf8'),
  }
}

function write(file, content) {
  if (content === file.original) {
    return
  }

  writeFileSync(file.filePath, content, 'utf8')
  changedFiles.push(file.relativePath)
}

/*
 * 1. 解决 TypeScript 与 Biome 的索引访问规则冲突。
 *
 * TypeScript 开启 noPropertyAccessFromIndexSignature 后，
 * Record<string, unknown> 必须使用 record['key']。
 *
 * 因此关闭 Biome useLiteralKeys，避免它要求改回 record.key。
 */
{
  const file = read('biome.json')
  const config = JSON.parse(file.original)

  config.linter ??= {}
  config.linter.rules ??= {}
  config.linter.rules.complexity ??= {}

  const previous = config.linter.rules.complexity.useLiteralKeys

  config.linter.rules.complexity.useLiteralKeys = 'off'

  if (previous === 'off') {
  } else {
  }

  const updated = `${JSON.stringify(config, null, 2)}\n`

  write(file, updated)
}

/*
 * 2. TransformGroup 改用语义化 fieldset。
 *
 * fieldset 的隐式 role 就是 group，因此不再需要：
 *   <div role="group">
 */
{
  const file = read('editor/core/src/react/CanvasTransformStatus.tsx')

  let content = file.original

  const functionStart = content.indexOf('function TransformGroup(')

  const functionEnd = content.indexOf('interface InlineTransformFieldProps', functionStart)

  if (functionStart === -1 || functionEnd === -1) {
    throw new Error(['无法找到 TransformGroup 函数。', `文件：${file.relativePath}`].join('\n'))
  }

  let functionContent = content.slice(functionStart, functionEnd)

  if (functionContent.includes('<fieldset') && functionContent.includes('</fieldset>')) {
  } else {
    if (!functionContent.includes('<div')) {
      throw new Error('TransformGroup 中没有找到 div 开始标签')
    }

    if (!functionContent.includes('</div>')) {
      throw new Error('TransformGroup 中没有找到 div 结束标签')
    }

    functionContent = functionContent.replace('<div', '<fieldset')

    functionContent = functionContent.replace('</div>', '</fieldset>')
  }

  /*
   * fieldset 已经有隐式 group role。
   */
  functionContent = functionContent.replace(/\s*role="group"/g, '')

  /*
   * 清除 fieldset 浏览器默认样式，维持原有布局。
   */
  if (!functionContent.includes('m-0 min-w-0 border-0 p-0')) {
    functionContent = functionContent.replace(
      'inline-flex h-6 shrink-0 items-center gap-0.5',
      ['m-0 min-w-0 border-0 p-0', 'inline-flex h-6 shrink-0 items-center gap-0.5'].join(
        '\n        ',
      ),
    )
  }

  content = content.slice(0, functionStart) + functionContent + content.slice(functionEnd)

  write(file, content)
}

try {
  execSync('pnpm exec biome check --write --unsafe .', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
} catch {
  /*
   * Biome 即使仍有不可自动修复的问题，也会先写入可以修复的内容。
   * 因此这里继续执行，让用户通过完整 lint 查看剩余诊断。
   */
  console.warn('\nBiome 已应用可自动修复的内容，但可能仍有剩余诊断。')
}

if (changedFiles.length === 0) {
} else {
  for (const _file of changedFiles) {
  }
}
