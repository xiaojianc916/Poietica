import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const changedFiles = []

function openFile(relativePath) {
  const filePath = resolve(root, relativePath)

  if (!existsSync(filePath)) {
    throw new Error(`找不到文件：${relativePath}`)
  }

  const content = readFileSync(filePath, 'utf8')

  return {
    relativePath,
    filePath,
    originalContent: content,
    content,
  }
}

function saveFile(file) {
  if (file.content === file.originalContent) {
    console.log(`跳过：${file.relativePath}`)
    return
  }

  writeFileSync(file.filePath, file.content, 'utf8')
  changedFiles.push(file.relativePath)
  console.log(`已修改：${file.relativePath}`)
}

function replaceRequired(file, oldText, newText, description) {
  if (!file.content.includes(oldText)) {
    throw new Error(
      [
        `无法完成修改：${description}`,
        `文件：${file.relativePath}`,
        '原因：没有找到预期代码。',
      ].join('\n'),
    )
  }

  file.content = file.content.replace(oldText, newText)
}

function removeRepeatedExact(content, text) {
  const duplicated = text + text

  while (content.includes(duplicated)) {
    content = content.replace(duplicated, text)
  }

  return content
}

function ensureCommentBefore(file, target, comment, description) {
  const expected = `${comment}\n${target}`

  if (file.content.includes(expected)) {
    console.log(`已处理：${description}`)
    return
  }

  if (!file.content.includes(target)) {
    throw new Error(`无法找到注释目标：${description}\n文件：${file.relativePath}`)
  }

  file.content = file.content.replace(target, expected)
}

function ensureReactNamedImport(file, importName) {
  const match = file.content.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]react['"]/)

  if (!match) {
    throw new Error(`无法找到 React import：${file.relativePath}`)
  }

  const currentImport = match[0]

  if (new RegExp(`\\b${importName}\\b`).test(currentImport)) {
    console.log(`已处理：导入 ${importName}`)
    return
  }

  let nextImport

  if (/\buseEffect\b/.test(currentImport)) {
    nextImport = currentImport.replace(/\buseEffect\b/, `${importName}, useEffect`)
  } else {
    nextImport = currentImport.replace(/\}\s*from/, `  ${importName},\n} from`)
  }

  file.content = file.content.replace(currentImport, nextImport)
}

function ensureSvgTitle(file, title) {
  if (/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/.test(file.content)) {
    console.log(`已处理：${file.relativePath} 已包含 SVG title`)
    return
  }

  const match = file.content.match(/<svg\b[^>]*>/)

  if (!match || match.index === undefined) {
    throw new Error(`无法找到 SVG 开始标签：${file.relativePath}`)
  }

  const newline = file.content.includes('\r\n') ? '\r\n' : '\n'
  const insertionIndex = match.index + match[0].length

  file.content =
    file.content.slice(0, insertionIndex) +
    `${newline}  <title>${title}</title>` +
    file.content.slice(insertionIndex)
}

function ensureSvgTitleByClass(file, className, title) {
  if (file.content.includes(`<title>${title}</title>`)) {
    console.log(`已处理：${title}`)
    return
  }

  const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const pattern = new RegExp(`(<svg\\b[^>]*className="${escapedClassName}"[^>]*>)`)

  if (!pattern.test(file.content)) {
    throw new Error(`无法找到 SVG：${className}\n文件：${file.relativePath}`)
  }

  file.content = file.content.replace(pattern, `$1\n        <title>${title}</title>`)
}

/*
 * 1. canvas-workflow.test.ts
 */
{
  const file = openFile('apps/desktop/src/application/canvas/canvas-workflow.test.ts')

  const oldBlock = `    const documents = createDocumentPort(async () => {
      attempts += 1

      if (attempts === 1) {
        return {
          kind: 'release-failed',
          failure: {
            code: 'persistence',
            recoverable: true,
          },
        }
      }

      return { kind: 'released' }
    })`

  const newBlock = `    const documents = createDocumentPort(() => {
      attempts += 1

      if (attempts === 1) {
        return Promise.resolve({
          kind: 'release-failed',
          failure: {
            code: 'persistence',
            recoverable: true,
          },
        })
      }

      return Promise.resolve({ kind: 'released' })
    })`

  if (file.content.includes(newBlock)) {
    console.log('已处理：修复测试回调 useAwait')
  } else if (file.content.includes(oldBlock)) {
    file.content = file.content.replace(oldBlock, newBlock)
  } else {
    throw new Error(`无法找到 release retry 测试回调：${file.relativePath}`)
  }

  saveFile(file)
}

/*
 * 2. CanvasTransformStatus.tsx
 */
{
  const file = openFile('editor/core/src/react/CanvasTransformStatus.tsx')

  const roleLine = '      role="group"\n'

  file.content = removeRepeatedExact(file.content, roleLine)

  if (!/aria-label=\{label\}\s*\n\s*role="group"/.test(file.content)) {
    file.content = file.content.replace(
      /(<div\s*\n\s*aria-label=\{label\})/,
      '$1\n      role="group"',
    )
  }

  if (!/aria-label=\{label\}\s*\n\s*role="group"/.test(file.content)) {
    throw new Error(`无法为 TransformGroup 添加 role：${file.relativePath}`)
  }

  const complexityComment =
    '  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 键盘事件分支集中描述一个输入框的完整交互协议'

  file.content = removeRepeatedExact(file.content, `${complexityComment}\n`)

  ensureCommentBefore(
    file,
    '  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {',
    complexityComment,
    '说明键盘事件处理器复杂度',
  )

  saveFile(file)
}

/*
 * 3. SidebarSplitter.tsx
 */
{
  const file = openFile('features/workspace/src/presentation/shell/SidebarSplitter.tsx')

  ensureReactNamedImport(file, 'useCallback')

  file.content = file.content.replaceAll('HTMLDivElement', 'HTMLHRElement')

  const originalRestore = `  const restoreBodyInteraction = (session: SidebarDragSession) => {
    document.body.style.cursor = session.previousBodyCursor

    document.body.style.userSelect = session.previousBodyUserSelect
  }`

  const callbackRestore = `  const restoreBodyInteraction = useCallback((session: SidebarDragSession) => {
    document.body.style.cursor = session.previousBodyCursor

    document.body.style.userSelect = session.previousBodyUserSelect
  }, [])`

  if (file.content.includes(callbackRestore)) {
    console.log('已处理：稳定 restoreBodyInteraction 引用')
  } else if (file.content.includes(originalRestore)) {
    file.content = file.content.replace(originalRestore, callbackRestore)
  } else if (!/const restoreBodyInteraction\s*=\s*useCallback/.test(file.content)) {
    throw new Error(`无法修改 restoreBodyInteraction：${file.relativePath}`)
  }

  file.content = file.content.replace(
    /return\s*\(\s*<div(\s+aria-label="调整侧边栏宽度")/,
    'return (\n    <hr$1',
  )

  file.content = file.content.replace(/\n\s*role="separator"/g, '')

  if (!/<hr\s+aria-label="调整侧边栏宽度"/.test(file.content)) {
    throw new Error(`无法把 SidebarSplitter 改为 hr：${file.relativePath}`)
  }

  saveFile(file)
}

/*
 * 4. WorkspaceShell.tsx
 */
{
  const file = openFile('features/workspace/src/presentation/shell/WorkspaceShell.tsx')

  const complexityComment =
    '// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 工作区外壳集中编排响应式区域及其条件渲染'

  file.content = removeRepeatedExact(file.content, `${complexityComment}\n`)

  ensureCommentBefore(
    file,
    'export function WorkspaceShell({',
    complexityComment,
    '说明 WorkspaceShell 编排复杂度',
  )

  file.content = file.content.replace(/\n\s*onClose=\{\(\) => setSidebarOpen\(false\)\}/g, '')

  saveFile(file)
}

/*
 * 5. WorkspaceSidebar.tsx
 */
{
  const file = openFile('features/workspace/src/presentation/shell/WorkspaceSidebar.tsx')

  file.content = file.content.replace(/\n\s*readonly onClose: \(\) => void/g, '')

  file.content = file.content.replace(/\n\s*onClose,\s*(?=\n)/g, '')

  saveFile(file)
}

/*
 * 6. chrome-workbench-tabs.css
 */
{
  const file = openFile('features/workspace/src/presentation/shell/chrome-workbench-tabs.css')

  const baseRulePattern =
    /\.chrome-workbench-tab__separator\s*\{\s*position:\s*absolute;[\s\S]*?transition:\s*opacity 100ms ease-out;\s*\}\s*/

  const baseMatch = file.content.match(baseRulePattern)

  const suppressSelector =
    '.chrome-workbench-tab[data-suppress-hover="true"] .chrome-workbench-tab__separator {'

  const suppressIndex = file.content.indexOf(suppressSelector)

  if (!baseMatch || baseMatch.index === undefined) {
    throw new Error(`无法找到 separator 基础规则：${file.relativePath}`)
  }

  if (suppressIndex === -1) {
    throw new Error(`无法找到 suppress-hover 规则：${file.relativePath}`)
  }

  if (baseMatch.index > suppressIndex) {
    const baseRule = baseMatch[0].trimEnd()

    file.content = file.content.replace(baseMatch[0], '')

    file.content = file.content.replace(suppressSelector, `${baseRule}\n\n${suppressSelector}`)
  }

  file.content = file.content.replace(
    `  .chrome-workbench-tab__content,
  .chrome-workbench-tab__separator,
  .chrome-workbench-tab__status,`,
    `  .chrome-workbench-tab__content,
  .chrome-workbench-tab[data-active] .chrome-workbench-tab__separator,
  .chrome-workbench-tab__status,`,
  )

  saveFile(file)
}

/*
 * 7. result.ts
 */
{
  const file = openFile('foundations/kernel/src/result.ts')

  const oldCode = `  const last = results[results.length - 1]!
  return last._tag === 'Err' ? last : err(undefined as E)`

  const newCode = `  const last = results.at(-1)

  return last?._tag === 'Err' ? last : err(undefined as E)`

  if (file.content.includes(oldCode)) {
    file.content = file.content.replace(oldCode, newCode)
  } else if (!file.content.includes('const last = results.at(-1)')) {
    throw new Error(`无法修改 firstOk 非空断言：${file.relativePath}`)
  }

  saveFile(file)
}

/*
 * 8. SVG 图标
 */
{
  const file = openFile('apps/desktop/src-tauri/icons/icon-small.svg')

  ensureSvgTitle(file, 'Hybrid Canvas')

  saveFile(file)
}

{
  const file = openFile('apps/desktop/src-tauri/icons/icon.svg')

  ensureSvgTitle(file, 'Hybrid Canvas')

  saveFile(file)
}

/*
 * 9. WorkbenchTabs.tsx
 */
{
  const file = openFile('features/workspace/src/presentation/shell/WorkbenchTabs.tsx')

  ensureSvgTitleByClass(
    file,
    'chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--left',
    '活动标签页左侧轮廓',
  )

  ensureSvgTitleByClass(
    file,
    'chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--right',
    '活动标签页右侧轮廓',
  )

  if (!/className=\{`chrome-workbench-tab__status[\s\S]*?\n\s*role="status"/.test(file.content)) {
    file.content = file.content.replace(
      /(\s+className=\{`chrome-workbench-tab__status chrome-workbench-tab__status--\$\{status\}`\})(\s*\/>)/,
      '$1\n          role="status"$2',
    )
  }

  if (!/className=\{`chrome-workbench-tab__status[\s\S]*?\n\s*role="status"/.test(file.content)) {
    throw new Error(`无法为标签状态添加 role：${file.relativePath}`)
  }

  saveFile(file)
}

/*
 * 10. StatusBarHost.tsx
 */
{
  const file = openFile('features/workspace/src/presentation/status/StatusBarHost.tsx')

  if (!/aria-label="画布状态栏"\s*\n\s*role="status"/.test(file.content)) {
    file.content = file.content.replace(
      '      aria-label="画布状态栏"',
      `      aria-label="画布状态栏"
      role="status"`,
    )
  }

  saveFile(file)
}

/*
 * 11. dialog.tsx
 */
{
  const file = openFile('foundations/design-system/src/components/ui/dialog.tsx')

  const comment =
    '    // biome-ignore lint/a11y/noStaticElementInteractions: 对话框遮罩仅检测背景点击，不是独立交互控件'

  file.content = removeRepeatedExact(file.content, `${comment}\n`)

  ensureCommentBefore(file, '    <div\n      className={cn(', comment, '说明对话框遮罩交互')

  saveFile(file)
}

/*
 * 12. label.tsx
 */
{
  const file = openFile('foundations/design-system/src/components/ui/label.tsx')

  const comment =
    '    // biome-ignore lint/a11y/noLabelWithoutControl: 通用标签由调用处通过 htmlFor 或嵌套控件建立关联'

  file.content = removeRepeatedExact(file.content, `${comment}\n`)

  ensureCommentBefore(file, '    <label\n      className={cn(', comment, '说明通用 Label 关联方式')

  saveFile(file)
}

/*
 * 13. errors.ts
 */
{
  const file = openFile('foundations/kernel/src/errors.ts')

  const oldCode = `      ;(
        Error as { captureStackTrace?: (target: object, constructor: Function) => void }
      ).captureStackTrace?.(this, this.constructor)`

  const newCode =
    '      ;(Error as { captureStackTrace?: (target: object) => void }).captureStackTrace?.(this)'

  if (file.content.includes(oldCode)) {
    file.content = file.content.replace(oldCode, newCode)
  } else if (
    /constructor:\s*Function/.test(file.content) ||
    /\.captureStackTrace\?\.\(this,\s*this\.constructor\)/.test(file.content)
  ) {
    file.content = file.content.replace(
      /;\(\s*Error as \{\s*captureStackTrace\?:\s*\(target:\s*object,\s*constructor:\s*Function\)\s*=>\s*void\s*\}\s*\)\.captureStackTrace\?\.\(this,\s*this\.constructor\)/,
      ';(Error as { captureStackTrace?: (target: object) => void }).captureStackTrace?.(this)',
    )
  }

  if (
    /constructor:\s*Function/.test(file.content) ||
    /\.captureStackTrace\?\.\(this,\s*this\.constructor\)/.test(file.content)
  ) {
    throw new Error(`无法修复 captureStackTrace 类型：${file.relativePath}`)
  }

  saveFile(file)
}

console.log('')

if (changedFiles.length === 0) {
  console.log('所有目标修改均已存在，没有写入文件。')
} else {
  console.log(`完成，共修改 ${changedFiles.length} 个文件：`)

  for (const relativePath of changedFiles) {
    console.log(`- ${relativePath}`)
  }
}

console.log('')
console.log('下一步运行：')
console.log('  pnpm exec biome check --write .')
console.log('  pnpm exec biome lint . --max-diagnostics=200')
