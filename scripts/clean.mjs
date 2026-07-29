#!/usr/bin/env node
/**
 * Removes build output, caches and installed dependencies.
 *
 * 三件事和上一版不同，每一件都是被一次真实的失败换来的。
 *
 * 一、删除会重试。Windows 上一个刚跑过的可执行文件在进程退出后仍会被短暂持有，
 * unlink 于是抛 EPERM。fs.rm 本来就带针对这种情况的退避重试，但 maxRetries 默认
 * 是 0 —— 上一版等于把标准库已经写好的能力关着不用，然后在第一次占用上炸掉。
 * force: true 不负责这件事：它只忽略"不存在"。
 *
 * 二、失败会被隔离并汇报，不再是一个未捕获的异常。清理是一串互不依赖的删除，
 * 其中一个删不掉不构成停下的理由；停下来的代价是把人留在"依赖已经没了、产物
 * 还在"的半坏状态里，而那正是上一版制造出来的局面。
 *
 * 三、顺序是选出来的，不是 readdir 给的。上一版按字母序走，node_modules 恰好
 * 排在 target 前面，于是最不可逆的一步总是先做、最容易失败的一步总是后做，失败
 * 的代价被放大到最大。现在依赖永远最后删。
 *
 * 范围也分了档：清一次 Vite 预构建缓存不该附带一次 Rust 全量重编译。Rust 那一
 * 层默认不碰，它有 cargo clean，那是它自己的事。
 */

import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

/*
 * 三档范围。cache 是日常那一档：产物、任务缓存，以及 Vite 的依赖预构建缓存 ——
 * 最后这个住在 node_modules 里，所以即便这一档不删 node_modules 也要单独伸手进
 * 去拿它，否则"改了组件却没生效"这个最常见的症状根本清不掉。
 */
const SCOPES = {
  all: new Set(['.turbo', 'dist', 'node_modules', 'target']),
  cache: new Set(['.turbo', 'dist']),
  deps: new Set(['.turbo', 'dist', 'node_modules']),
}

const NEVER_ENTER = new Set(['.git'])

const DRY_RUN = process.argv.includes('--dry-run')

function chosenScope() {
  if (process.argv.includes('--all')) {
    return 'all'
  }
  if (process.argv.includes('--cache')) {
    return 'cache'
  }
  return 'deps'
}

const scopeName = chosenScope()
const scope = SCOPES[scopeName]

const rel = (target) => path.relative(process.cwd(), target).split(path.sep).join('/')

/*
 * node_modules 最后删。它是唯一一个删掉之后就不能再跑任何 node 工具的目录，所以
 * 任何一个可能失败的删除都应该发生在它之前。
 */
function weight(target) {
  return path.basename(target) === 'node_modules' ? 1 : 0
}

async function collect(directory, found) {
  let entries

  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || NEVER_ENTER.has(entry.name)) {
      continue
    }

    const target = path.join(directory, entry.name)

    if (entry.name === 'node_modules') {
      /*
       * 从不深入 node_modules：它要么整个走，要么只交出 .vite。往里递归会为了
       * 几个缓存目录走完成千上万个包。
       */
      if (scope.has('node_modules')) {
        found.push(target)
      } else {
        const viteCache = path.join(target, '.vite')

        if (existsSync(viteCache)) {
          found.push(viteCache)
        }
      }

      continue
    }

    if (scope.has(entry.name)) {
      found.push(target)
      continue
    }

    await collect(target, found)
  }

  return found
}

const targets = (await collect(process.cwd(), [])).sort((a, b) => weight(a) - weight(b))

if (DRY_RUN) {
  for (const target of targets) {
    console.log(`Would remove ${rel(target)}`)
  }

  console.log(`\n${targets.length} directories in scope "${scopeName}".`)
  process.exit(0)
}

const failures = []
let removed = 0

for (const target of targets) {
  try {
    await rm(target, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 })
    removed += 1
  } catch (error) {
    failures.push({ path: rel(target), reason: error.code ?? String(error) })
  }
}

console.log(`Removed ${removed} directories (scope: ${scopeName}).`)

if (failures.length > 0) {
  console.error(`\n${failures.length} could not be removed:`)

  for (const failure of failures) {
    console.error(`  ${failure.path} — ${failure.reason}`)
  }

  console.error(
    '\nEPERM/EBUSY on Windows means something still holds the file: a running app, ' +
      'a dev server, or rust-analyzer. Close it and run again.',
  )

  process.exitCode = 1
}

if (scope.has('node_modules') && failures.length === 0) {
  console.log('\nDependencies are gone — run "pnpm install" before anything else.')
}
