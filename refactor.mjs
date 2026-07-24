import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const changedFiles = []

function load(relativePath) {
  const filePath = resolve(root, relativePath)

  if (!existsSync(filePath)) {
    throw new Error(`找不到文件：${relativePath}`)
  }

  return {
    relativePath,
    filePath,
    content: readFileSync(filePath, 'utf8'),
  }
}

function save(file) {
  if (file.content === readFileSync(file.filePath, 'utf8')) {
    console.log(`跳过：${file.relativePath}`)
    return
  }

  writeFileSync(file.filePath, file.content, 'utf8')
  changedFiles.push(file.relativePath)
  console.log(`已修改：${file.relativePath}`)
}

function replaceOnce(file, oldText, newText, description) {
  /*
   * 插入型替换通常满足 newText.includes(oldText)。
   * 必须先判断完整的新代码，否则重复执行时会再次插入。
   */
  if (newText !== '' && newText.includes(oldText) && file.content.includes(newText)) {
    console.log(`已处理：${description}`)
    return
  }

  const firstIndex = file.content.indexOf(oldText)

  if (firstIndex === -1) {
    if (newText !== '' && file.content.includes(newText)) {
      console.log(`已处理：${description}`)
      return
    }

    throw new Error(
      [
        `无法完成修改：${description}`,
        `文件：${file.relativePath}`,
        '原因：没有找到预期的原始代码，仓库内容可能已经发生变化。',
      ].join('\n'),
    )
  }

  if (file.content.indexOf(oldText, firstIndex + oldText.length) !== -1) {
    throw new Error(
      [
        `无法完成修改：${description}`,
        `文件：${file.relativePath}`,
        '原因：原始代码出现多次，拒绝进行不确定替换。',
      ].join('\n'),
    )
  }

  file.content =
    file.content.slice(0, firstIndex) + newText + file.content.slice(firstIndex + oldText.length)
}
/*
 * 1. canvas-workflow.test.ts
 * 去掉无 await 的 async 回调，并显式返回 Promise。
 */
{
  const file = load('apps/desktop/src/application/canvas/canvas-workflow.test.ts')

  replaceOnce(
    file,
    `    const documents = createDocumentPort(async () => {
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
    })`,
    `    const documents = createDocumentPort(() => {
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
    })`,
    '修复测试回调 useAwait',
  )

  save(file)
}

/*
 * 2. CanvasTransformStatus.tsx
 * - 为 aria-label 添加支持该属性的 group role。
 * - handleKeyDown 是键盘交互分派器，保留集中处理并添加定向说明。
 */
{
  const file = load('editor/core/src/react/CanvasTransformStatus.tsx')

  replaceOnce(
    file,
    `    <div
      aria-label={label}`,
    `    <div
      aria-label={label}
      role="group"`,
    '修复 TransformGroup ARIA role',
  )

  replaceOnce(
    file,
    `  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {`,
    `  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 键盘事件分支集中描述一个输入框的完整交互协议
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {`,
    '说明键盘事件处理器复杂度',
  )

  save(file)
}

/*
 * 3. SidebarSplitter.tsx
 * - restoreBodyInteraction 使用 useCallback。
 * - separator 改为语义化 hr。
 * - 同步调整事件元素类型。
 */
{
  const file = load('features/workspace/src/presentation/shell/SidebarSplitter.tsx')

  replaceOnce(
    file,
    `import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react'`,
    `import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react'`,
    '导入 useCallback',
  )

  replaceAll(file, 'HTMLDivElement', 'HTMLHRElement', '调整 SidebarSplitter 元素类型')

  replaceOnce(
    file,
    `  const restoreBodyInteraction = (session: SidebarDragSession) => {
    document.body.style.cursor = session.previousBodyCursor

    document.body.style.userSelect = session.previousBodyUserSelect
  }`,
    `  const restoreBodyInteraction = useCallback((session: SidebarDragSession) => {
    document.body.style.cursor = session.previousBodyCursor

    document.body.style.userSelect = session.previousBodyUserSelect
  }, [])`,
    '稳定 restoreBodyInteraction 引用',
  )

  replaceOnce(
    file,
    `  return (
    <div
      aria-label="调整侧边栏宽度"`,
    `  return (
    <hr
      aria-label="调整侧边栏宽度"`,
    '使用语义化 separator 元素',
  )

  replaceOnce(
    file,
    `      role="separator"
      tabIndex={0}`,
    `      tabIndex={0}`,
    '移除 hr 的重复 separator role',
  )

  save(file)
}

/*
 * 4. WorkspaceShell.tsx
 * WorkspaceShell 是页面区域编排组件，其复杂度主要来自声明式条件渲染。
 * 同时删除已经无效的 WorkspaceSidebar onClose 参数。
 */
{
  const file = load('features/workspace/src/presentation/shell/WorkspaceShell.tsx')

  replaceOnce(
    file,
    `export function WorkspaceShell({`,
    `// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 工作区外壳集中编排响应式区域及其条件渲染
export function WorkspaceShell({`,
    '说明 WorkspaceShell 编排复杂度',
  )

  replaceOnce(
    file,
    `      onActivatePage={actions.activatePage}
      onClose={() => setSidebarOpen(false)}
      onCreatePage={actions.createPage}`,
    `      onActivatePage={actions.activatePage}
      onCreatePage={actions.createPage}`,
    '删除未使用的 WorkspaceSidebar onClose 属性',
  )

  save(file)
}

/*
 * 5. WorkspaceSidebar.tsx
 * 删除未使用的 onClose。
 */
{
  const file = load('features/workspace/src/presentation/shell/WorkspaceSidebar.tsx')

  replaceOnce(
    file,
    `  readonly onClose: () => void
`,
    '',
    '删除 WorkspaceSidebarProps.onClose',
  )

  replaceOnce(
    file,
    `  pages,
  onClose,
  onActivatePage,`,
    `  pages,
  onActivatePage,`,
    '删除未使用的 onClose 解构参数',
  )

  save(file)
}

/*
 * 6. chrome-workbench-tabs.css
 * 将 separator 基础规则放在高特异性规则之前；
 * reduced-motion 规则使用相同特异性，避免 descending specificity。
 */
{
  const file = load('features/workspace/src/presentation/shell/chrome-workbench-tabs.css')

  const separatorBaseRule = `.chrome-workbench-tab__separator {
  position: absolute;
  z-index: 2;
  top: 9px;
  right: 3px;
  bottom: 9px;
  width: 1px;
  background: var(--chrome-tab-divider);
  opacity: 1;
  pointer-events: none;
  transition: opacity 100ms ease-out;
}

`

  if (file.content.includes(separatorBaseRule)) {
    file.content = file.content.replace(separatorBaseRule, '')

    replaceOnce(
      file,
      `.chrome-workbench-tab[data-suppress-hover="true"] .chrome-workbench-tab__separator {`,
      `${separatorBaseRule}.chrome-workbench-tab[data-suppress-hover="true"] .chrome-workbench-tab__separator {`,
      '移动 separator 基础规则',
    )
  } else {
    const expectedLocation = `${separatorBaseRule}.chrome-workbench-tab[data-suppress-hover="true"] .chrome-workbench-tab__separator {`

    if (!file.content.includes(expectedLocation)) {
      throw new Error('无法移动 chrome-workbench-tab__separator 基础规则：代码结构与预期不一致')
    }
  }

  replaceOnce(
    file,
    `  .chrome-workbench-tab__content,
  .chrome-workbench-tab__separator,
  .chrome-workbench-tab__status,
  .chrome-workbench-tab::before {`,
    `  .chrome-workbench-tab__content,
  .chrome-workbench-tab[data-active] .chrome-workbench-tab__separator,
  .chrome-workbench-tab__status,
  .chrome-workbench-tab::before {`,
    '修复 reduced-motion selector specificity',
  )

  save(file)
}

/*
 * 7. result.ts
 * 使用 at(-1) 和显式空值处理，避免非空断言。
 */
{
  const file = load('foundations/kernel/src/result.ts')

  replaceOnce(
    file,
    `  const last = results[results.length - 1]!
  return last._tag === 'Err' ? last : err(undefined as E)`,
    `  const last = results.at(-1)

  return last?._tag === 'Err' ? last : err(undefined as E)`,
    '删除 firstOk 中的非空断言',
  )

  save(file)
}

/*
 * 8. Tauri SVG 图标
 * 添加 title，满足 SVG 可访问性检查。
 */
{
  const file = load('apps/desktop/src-tauri/icons/icon-small.svg')

  replaceOnce(
    file,
    `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" >
  <g`,
    `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <title>Hybrid Canvas</title>
  <g`,
    '为 icon-small.svg 添加标题',
  )

  save(file)
}

{
  const file = load('apps/desktop/src-tauri/icons/icon.svg')

  replaceOnce(
    file,
    `<svg fill="none" height="1024" viewBox="0 0 1024 1024" width="1024" xmlns="http://www.w3.org/2000/svg">
  <defs>`,
    `<svg fill="none" height="1024" viewBox="0 0 1024 1024" width="1024" xmlns="http://www.w3.org/2000/svg">
  <title>Hybrid Canvas</title>
  <defs>`,
    '为 icon.svg 添加标题',
  )

  save(file)
}

/*
 * 9. WorkbenchTabs.tsx
 * - 为装饰 SVG 添加 title。
 * - 状态圆点使用 status role，使 aria-label 合法。
 */
{
  const file = load('features/workspace/src/presentation/shell/WorkbenchTabs.tsx')

  replaceOnce(
    file,
    `        viewBox="0 0 20 32"
      >
        <path`,
    `        viewBox="0 0 20 32"
      >
        <title>活动标签页左侧轮廓</title>

        <path`,
    '为左侧标签轮廓 SVG 添加标题',
  )

  replaceOnce(
    file,
    `        className="chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--right"
        preserveAspectRatio="xMinYMin meet"
        viewBox="0 0 20 32"
      >
        <path`,
    `        className="chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--right"
        preserveAspectRatio="xMinYMin meet"
        viewBox="0 0 20 32"
      >
        <title>活动标签页右侧轮廓</title>

        <path`,
    '为右侧标签轮廓 SVG 添加标题',
  )

  replaceOnce(
    file,
    `          aria-label={status === 'dirty' ? '未保存' : status === 'saving' ? '正在保存' : '保存失败'}
          className={\`chrome-workbench-tab__status chrome-workbench-tab__status--\${status}\`}
        />`,
    `          aria-label={status === 'dirty' ? '未保存' : status === 'saving' ? '正在保存' : '保存失败'}
          className={\`chrome-workbench-tab__status chrome-workbench-tab__status--\${status}\`}
          role="status"
        />`,
    '为标签保存状态添加 status role',
  )

  save(file)
}

/*
 * 10. StatusBarHost.tsx
 * footer 添加 status role，使 aria-label 合法。
 */
{
  const file = load('features/workspace/src/presentation/status/StatusBarHost.tsx')

  replaceOnce(
    file,
    `    <footer
      aria-label="画布状态栏"`,
    `    <footer
      aria-label="画布状态栏"
      role="status"`,
    '为状态栏添加 status role',
  )

  save(file)
}

/*
 * 11. dialog.tsx
 * 遮罩层需要监听鼠标事件，但它不是独立交互控件；
 * 使用定向说明，避免添加错误的 button role。
 */
{
  const file = load('foundations/design-system/src/components/ui/dialog.tsx')

  replaceOnce(
    file,
    `  return createPortal(
    <div
      className={cn(`,
    `  return createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 对话框遮罩仅用于检测背景点击，不是独立控件 */}
      <div
        className={cn(`,
    '说明对话框遮罩交互语义',
  )

  replaceOnce(
    file,
    `      </div>
    </div>,
    document.body,`,
    `        </div>
      </div>
    </>,
    document.body,`,
    '闭合对话框遮罩 Fragment',
  )

  save(file)
}

/*
 * 12. label.tsx
 * 通用 Label 的关联关系由 htmlFor 或 children 在调用处提供。
 */
{
  const file = load('foundations/design-system/src/components/ui/label.tsx')

  replaceOnce(
    file,
    `  return (
    <label
      className={cn(`,
    `  return (
    <>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: 通用标签通过调用处的 htmlFor 或嵌套控件建立关联 */}
      <label
        className={cn(`,
    '说明通用 Label 的控件关联方式',
  )

  replaceOnce(
    file,
    `      {...props}
    />
  )
})`,
    `        {...props}
      />
    </>
  )
})`,
    '闭合 Label Fragment',
  )

  save(file)
}

/*
 * 13. errors.ts
 * captureStackTrace 只需要目标对象，避免 Function 和 constructor 命名问题。
 */
{
  const file = load('foundations/kernel/src/errors.ts')

  replaceOnce(
    file,
    `      ;(
        Error as { captureStackTrace?: (target: object, constructor: Function) => void }
      ).captureStackTrace?.(this, this.constructor)`,
    `      ;(Error as { captureStackTrace?: (target: object) => void }).captureStackTrace?.(this)`,
    '修复 captureStackTrace 类型',
  )

  save(file)
}

if (changedFiles.length === 0) {
  console.log('\n没有文件需要修改。')
  process.exit(0)
}

console.log('\n正在格式化修改过的文件……')

execFileSync('pnpm', ['exec', 'biome', 'format', '--write', ...changedFiles], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log('\n修改完成。已修改文件：')

for (const file of changedFiles) {
  console.log(`- ${file}`)
}

console.log('\n请运行 pnpm exec biome lint . --max-diagnostics=200 检查日志中未显示的其余诊断。')
