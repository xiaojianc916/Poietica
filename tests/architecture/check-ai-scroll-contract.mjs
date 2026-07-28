#!/usr/bin/env node

/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

/**
 * 会话流滚动的地基契约。
 *
 * 末端锚定、追随新消息、流式增长补偿、回填稳定,这些都由虚拟器承担,它有四个
 * 前提:装机版本够新、锚定只有一个所有者、条目有持久身份、偏移基准不随渲染
 * 漂移。任何一条被破坏,症状都一样 —— 回滚时画面跳走 —— 而且都不会报错。
 * 所以固定在这里,而不是靠记忆。
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const aiSource = path.join(repositoryRoot, 'features', 'ai', 'src')

const failures = []

/*
 * 装机状态才是编译器与运行时看到的东西,而 pnpm 不提升依赖:核心包既不在仓库
 * 根也不在 features/ai 下,只有解析器找得到它。
 */
function locate(name, fromDirectory) {
  try {
    const resolver = createRequire(path.join(fromDirectory, 'package.json'))
    return path.dirname(resolver.resolve(`${name}/package.json`))
  } catch {
    return null
  }
}

const adapterDirectory = locate(
  '@tanstack/react-virtual',
  path.join(repositoryRoot, 'features', 'ai'),
)

const coreDirectory =
  adapterDirectory === null ? null : locate('@tanstack/virtual-core', adapterDirectory)

if (coreDirectory === null) {
  failures.push('@tanstack/virtual-core 未安装或无法解析：请运行 pnpm install')
} else {
  const declaration = path.join(coreDirectory, 'dist', 'esm', 'index.d.ts')
  const declares =
    existsSync(declaration) && (await readFile(declaration, 'utf8')).includes('anchorTo')

  if (!declares) {
    const version = JSON.parse(
      await readFile(path.join(coreDirectory, 'package.json'), 'utf8'),
    ).version

    failures.push(
      '@tanstack/virtual-core@' +
        version +
        ' 不提供 anchorTo（需要 3.17.0 及以上）：请运行 pnpm install',
    )
  }
}

const feedComponent = path.join(aiSource, 'presentation', 'feed', 'AgentActivityFeed.tsx')

if (existsSync(feedComponent)) {
  const source = await readFile(feedComponent, 'utf8')

  if (!source.includes('getItemKey')) {
    failures.push('AgentActivityFeed.tsx: 缺少 getItemKey，恢复或回填之后锚点会落到别的条目上')
  }

  if (!source.includes("anchorTo: 'end'")) {
    failures.push('AgentActivityFeed.tsx: 会话流的稳定侧是末端')
  }

  if (/useState[<(]/.test(source)) {
    failures.push(
      'AgentActivityFeed.tsx: 偏移基准不进 state，否则动画每帧都会挪动基准并重渲染整条对话',
    )
  }

  if (source.includes('getBoundingClientRect')) {
    failures.push('AgentActivityFeed.tsx: 画布偏移是一次 offsetTop，不需要手算')
  }
}

const styles = path.join(aiSource, 'presentation', 'feed', 'agent-activity-feed.css')

if (existsSync(styles)) {
  const source = await readFile(styles, 'utf8')

  if (!/overflow-anchor\s*:\s*none/.test(source)) {
    failures.push('agent-activity-feed.css: 原生滚动锚定必须关闭，否则同一次尺寸变化会被补偿两次')
  }
}

for (const filePath of await walk(aiSource)) {
  const relativePath = path.relative(repositoryRoot, filePath)

  if (relativePath.includes('__tests__')) {
    continue
  }

  const source = await readFile(filePath, 'utf8')

  if (/\.scrollTop\s*[+-]?=/.test(source)) {
    failures.push(`${relativePath}: 滚动位置归虚拟器所有，产品代码不得赋值`)
  }
}

if (failures.length > 0) {
  console.error('')
  console.error('AI scroll contract violations:')
  console.error('')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  console.error('')
  process.exitCode = 1
} else {
  console.log('AI scroll contract is valid.')
}

async function walk(directory) {
  if (!existsSync(directory)) {
    return []
  }
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(entryPath)
    }
  }
  return files
}
