#!/usr/bin/env node

/* biome-ignore-all lint/suspicious/noConsole: Architecture checks are command-line programs that report diagnostics to stdout and stderr. */

/**
 * 会话流滚动的地基契约。
 *
 * 末端锚定、追随新消息、流式增长补偿、回填稳定,这些都由虚拟器承担,它有三个
 * 前提:锚定只有一个所有者、条目有持久身份、偏移基准不随渲染漂移。任何一条被
 * 破坏,症状都一样 —— 回滚时画面跳走 —— 而且都不会报错。所以固定在这里,而不
 * 是靠记忆。
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const aiSource = path.join(repositoryRoot, 'features', 'ai', 'src')

const failures = []

const feedComponent = path.join(aiSource, 'presentation', 'feed', 'AgentActivityFeed.tsx')

if (existsSync(feedComponent)) {
  const source = await readFile(feedComponent, 'utf8')

  if (!source.includes('getItemKey')) {
    failures.push('AgentActivityFeed.tsx: 缺少 getItemKey,恢复或回填之后锚点会落到别的条目上')
  }

  if (!source.includes("anchorTo: 'end'")) {
    failures.push('AgentActivityFeed.tsx: 会话流的稳定侧是末端')
  }

  if (/useState[<(]/.test(source)) {
    failures.push(
      'AgentActivityFeed.tsx: 偏移基准不进 state,否则动画每帧都会挪动基准并重渲染整条对话',
    )
  }

  if (source.includes('getBoundingClientRect')) {
    failures.push('AgentActivityFeed.tsx: 画布偏移是一次 offsetTop,不需要手算')
  }
}

const styles = path.join(aiSource, 'presentation', 'feed', 'agent-activity-feed.css')

if (existsSync(styles)) {
  const source = await readFile(styles, 'utf8')

  if (!/overflow-anchor\s*:\s*none/.test(source)) {
    failures.push('agent-activity-feed.css: 原生滚动锚定必须关闭,否则同一次尺寸变化会被补偿两次')
  }
}

for (const filePath of await walk(aiSource)) {
  const relativePath = path.relative(repositoryRoot, filePath)

  if (relativePath.includes('__tests__')) {
    continue
  }

  const source = await readFile(filePath, 'utf8')

  if (/\.scrollTop\s*[+-]?=/.test(source)) {
    failures.push(relativePath + ': 滚动位置归虚拟器所有,产品代码不得赋值')
  }
}

if (failures.length > 0) {
  console.error('')
  console.error('AI scroll contract violations:')
  console.error('')
  for (const failure of failures) {
    console.error('- ' + failure)
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
