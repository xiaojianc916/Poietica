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
    original: content,
    content,
  }
}

function saveFile(file) {
  if (file.content === file.original) {
    console.log(`跳过：${file.relativePath}`)
    return
  }

  writeFileSync(file.filePath, file.content, 'utf8')
  changedFiles.push(file.relativePath)

  console.log(`已修改：${file.relativePath}`)
}

function ensureCommentBefore(file, target, comment, description) {
  const expected = `${comment}\n${target}`

  if (file.content.includes(expected)) {
    console.log(`已处理：${description}`)
    return
  }

  if (!file.content.includes(target)) {
    throw new Error(
      [`无法完成修改：${description}`, `文件：${file.relativePath}`, `没有找到：${target}`].join(
        '\n',
      ),
    )
  }

  file.content = file.content.replace(target, expected)
}

function transformGroupWrapper(file, startMarker, endMarker, description) {
  const start = file.content.indexOf(startMarker)
  const end = file.content.indexOf(endMarker, start)

  if (start === -1 || end === -1) {
    throw new Error([`无法定位组件：${description}`, `文件：${file.relativePath}`].join('\n'))
  }

  let section = file.content.slice(start, end)

  if (!section.includes('<fieldset')) {
    if (!section.includes('<div')) {
      throw new Error(`${description} 中没有找到 div 开始标签`)
    }

    section = section.replace('<div', '<fieldset')
  }

  if (!section.includes('</fieldset>')) {
    if (!section.includes('</div>')) {
      throw new Error(`${description} 中没有找到 div 结束标签`)
    }

    /*
     * 这些组件的第一个结束 div 就是外层 group 容器。
     */
    section = section.replace('</div>', '</fieldset>')
  }

  /*
   * fieldset 已有隐式 group 语义。
   */
  section = section.replace(/\n\s*role="group"/g, '')

  /*
   * 清除 fieldset 的浏览器默认样式，
   * 避免修改现有属性面板布局。
   */
  if (!section.includes('style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}')) {
    const dataMixedPattern = /(\n\s*data-mixed=\{value\.type === 'mixed' \? '' : undefined\})/

    if (!dataMixedPattern.test(section)) {
      throw new Error(`${description} 中没有找到 data-mixed 属性`)
    }

    section = section.replace(
      dataMixedPattern,
      `$1
      style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}`,
    )
  }

  file.content = file.content.slice(0, start) + section + file.content.slice(end)

  console.log(`已处理：${description}`)
}

/*
 * PropertiesInspectorContent.tsx
 */
{
  const file = openFile('editor/core/src/react/PropertiesInspectorContent.tsx')

  /*
   * selectionCapabilities 是一个集中式能力矩阵。
   * 将回调拆成多个 Hook 会让同一个编辑器快照产生不一致，
   * 因此保留集中计算并添加定向复杂度说明。
   */
  const capabilityComment =
    '// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 选择能力必须从同一个编辑器快照集中计算，避免拆分后产生状态不一致'

  if (!file.content.includes(capabilityComment)) {
    const compactTarget =
      "useValue<SelectionCapabilities>('right properties sidebar selection capabilities', () => {"

    if (file.content.includes(compactTarget)) {
      file.content = file.content.replace(
        compactTarget,
        `useValue<SelectionCapabilities>(
      'right properties sidebar selection capabilities',
      ${capabilityComment}
      () => {`,
      )
    } else {
      const multilinePattern =
        /(useValue<SelectionCapabilities>\(\s*['"]right properties sidebar selection capabilities['"],\s*)(\(\) => \{)/

      if (!multilinePattern.test(file.content)) {
        throw new Error('无法找到 selectionCapabilities 的 useValue 回调')
      }

      file.content = file.content.replace(
        multilinePattern,
        `$1${capabilityComment}
      $2`,
      )
    }
  } else {
    console.log('已处理：selectionCapabilities 复杂度说明')
  }

  /*
   * StyleSections 是样式属性到 UI 区域的声明式映射。
   */
  ensureCommentBefore(
    file,
    'function StyleSections({ styles }: { readonly styles: ReadonlySharedStyleMap }) {',
    '// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 样式面板按可用共享样式声明式渲染，各条件对应独立控件',
    'StyleSections 复杂度说明',
  )

  /*
   * SelectionActions 是能力矩阵到操作按钮的声明式映射。
   */
  ensureCommentBefore(
    file,
    'function SelectionActions({',
    '// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 操作面板集中映射选择能力到独立按钮，条件不共享控制流',
    'SelectionActions 复杂度说明',
  )

  /*
   * 三个 group 容器改为 fieldset。
   */
  transformGroupWrapper(
    file,
    'function OpacityControl(',
    'function ColorControl(',
    'OpacityControl 使用 fieldset',
  )

  transformGroupWrapper(
    file,
    'function ColorControl(',
    'interface StyleControlProps',
    'ColorControl 使用 fieldset',
  )

  transformGroupWrapper(
    file,
    'function StyleControl<',
    'interface SidebarSectionProps',
    'StyleControl 使用 fieldset',
  )

  /*
   * TldrawUiIcon 已经通过 label 提供可访问名称，
   * 外层静态 span 不应再设置 aria-label。
   */
  file.content = file.content.replace(
    '<span aria-label="多个值" className="hc-properties-sidebar__mixed" title="多个值">',
    '<span className="hc-properties-sidebar__mixed" title="多个值">',
  )

  if (file.content.includes('<span aria-label="多个值" className="hc-properties-sidebar__mixed"')) {
    throw new Error('无法删除 mixed span 上的无效 aria-label')
  }

  saveFile(file)
}

/*
 * canvas-document-open-rollback.test.ts
 */
{
  const file = openFile(
    'tests/integration/document-lifecycle/canvas-document-open-rollback.test.ts',
  )

  const oldCreate = `    create: vi.fn(async () => {
      throw editorOpenError
    }),`

  const newCreate = '    create: vi.fn(() => Promise.reject(editorOpenError)),'

  if (file.content.includes(oldCreate)) {
    file.content = file.content.replace(oldCreate, newCreate)
  } else if (!file.content.includes(newCreate)) {
    throw new Error('无法找到 editorSessions.create 测试回调')
  }

  const oldClose = `  const close = rollbackError
    ? vi.fn(async () => {
        throw rollbackError
      })
    : vi.fn(async () => {})`

  const newClose = `  const close = rollbackError
    ? vi.fn(() => Promise.reject(rollbackError))
    : vi.fn(() => Promise.resolve())`

  if (file.content.includes(oldClose)) {
    file.content = file.content.replace(oldClose, newClose)
  } else if (!file.content.includes(newClose)) {
    throw new Error('无法找到 persistence.close 测试回调')
  }

  saveFile(file)
}

console.log('')

if (changedFiles.length === 0) {
  console.log('所有目标修改均已存在。')
} else {
  console.log(`完成，共修改 ${changedFiles.length} 个文件：`)

  for (const file of changedFiles) {
    console.log(`- ${file}`)
  }
}

console.log('')
console.log('下一步运行：')
console.log('  pnpm exec biome check --write .')
console.log('  pnpm exec biome lint . --max-diagnostics=200')
console.log('  pnpm typecheck')
console.log('  pnpm test')
