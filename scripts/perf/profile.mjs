#!/usr/bin/env node
/**
 * 连上正在运行的 WebView2，采一段 CPU 或堆分配剖面。
 *
 * 先带上远程调试端口启动应用：
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
 *   pnpm dev
 *
 * 然后一边采样一边让 agent 输出一段长回答：
 *
 *   pnpm perf:profile              # CPU，默认 15 秒
 *   pnpm perf:profile -- --heap    # 堆分配归因
 *   pnpm perf:profile -- --seconds 30
 *
 * 产物落在 .perf/，可以直接拖进 DevTools 的 Performance / Memory 面板。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** 采样间隔，微秒。100 µs 足够看清每拍里的函数，又不至于让被测者变形。 */
const INTERVAL = 100

/** 剖面落盘的地方。 */
const OUT = '.perf'

/** 打出前几名。再往下就是噪声了。 */
const TOP = 20

function flag(name) {
  return process.argv.includes(\`--\${name}\`)
}

function option(name, fallback) {
  const at = process.argv.indexOf(\`--\${name}\`)

  return at === -1 ? fallback : Number(process.argv[at + 1] ?? fallback)
}

/** 挑出那个真正渲染界面的 target。 */
async function findPage(endpoint) {
  const response = await fetch(\`\${endpoint}/json/list\`)
  const targets = await response.json()

  return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
}

/** 一个够用的 CDP 客户端。请求应答配对，别的都不需要。 */
function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()

  let next = 0

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)

    if (settle === undefined) {
      return
    }

    pending.delete(message.id)

    if (message.error) {
      settle.reject(new Error(message.error.message))

      return
    }

    settle.resolve(message.result)
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve()
    })
    socket.addEventListener('error', () => {
      reject(new Error('devtools socket refused the connection'))
    })
  })

  return {
    ready,
    close: () => {
      socket.close()
    },
    send: (method, params = {}) => {
      next += 1

      const id = next

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

/** 把一棵剖面树按 self time 摊平成排行榜。 */
function rank(nodes, weigh) {
  const totals = new Map()

  for (const node of nodes) {
    const weight = weigh(node)

    if (weight <= 0) {
      continue
    }

    const frame = node.callFrame
    const file = (frame.url || '<native>').split(/[\\\\/]/).pop()
    const name = frame.functionName || '(anonymous)'
    const key = \`\${name}  \${file}:\${frame.lineNumber + 1}\`

    totals.set(key, (totals.get(key) ?? 0) + weight)
  }

  return [...totals].sort((left, right) => right[1] - left[1])
}

/** 把一棵 samplingHeapProfile 的树拍平成数组。 */
function flatten(node, into = []) {
  into.push(node)

  for (const child of node.children ?? []) {
    flatten(child, into)
  }

  return into
}

function report(rows, total, unit, scale) {
  console.log('')
  console.log(\`total \${(total / scale).toFixed(1)} \${unit}\`)
  console.log('')

  for (const [key, weight] of rows.slice(0, TOP)) {
    const share = ((weight / total) * 100).toFixed(1).padStart(5)

    console.log(\`\${share}%  \${(weight / scale).toFixed(1).padStart(9)} \${unit}  \${key}\`)
  }
}

async function main() {
  const endpoint = process.env.POIETICA_DEVTOOLS ?? 'http://127.0.0.1:9222'
  const page = await findPage(endpoint).catch(() => undefined)

  if (page === undefined) {
    console.error(\`no webview at \${endpoint}\`)
    console.error('')
    console.error('  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"')
    console.error('  pnpm dev')

    process.exitCode = 1

    return
  }

  const seconds = option('seconds', 15)
  const heap = flag('heap')
  const client = connect(page.webSocketDebuggerUrl)

  await client.ready
  await mkdir(OUT, { recursive: true })

  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')

  if (heap) {
    await client.send('HeapProfiler.enable')
    await client.send('HeapProfiler.startSampling', { samplingInterval: 16_384 })

    console.log(\`sampling allocations for \${String(seconds)}s — stream a long answer now\`)

    await sleep(seconds * 1_000)

    const { profile } = await client.send('HeapProfiler.stopSampling')
    const nodes = flatten(profile.head)
    const rows = rank(nodes, (node) =>
      (node.selfSize ?? 0) === 0 ? 0 : node.selfSize,
    )
    const total = rows.reduce((sum, [, weight]) => sum + weight, 0)
    const file = join(OUT, \`\${stamp}.heapprofile\`)

    await writeFile(file, JSON.stringify(profile), 'utf8')

    report(rows, total, 'MB', 1_048_576)
    console.log('')
    console.log(\`wrote \${file}\`)
  } else {
    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: INTERVAL })
    await client.send('Profiler.start')

    console.log(\`sampling cpu for \${String(seconds)}s — stream a long answer now\`)

    await sleep(seconds * 1_000)

    const { profile } = await client.send('Profiler.stop')

    /* timeDeltas[i] 是第 i 个样本之前的那段时间，按样本归给它命中的节点。 */
    const self = new Map()

    for (let index = 0; index < profile.samples.length; index += 1) {
      const id = profile.samples[index]
      const delta = profile.timeDeltas[index] ?? 0

      self.set(id, (self.get(id) ?? 0) + Math.max(delta, 0))
    }

    const rows = rank(profile.nodes, (node) => self.get(node.id) ?? 0)
    const total = rows.reduce((sum, [, weight]) => sum + weight, 0)
    const file = join(OUT, \`\${stamp}.cpuprofile\`)

    await writeFile(file, JSON.stringify(profile), 'utf8')

    report(rows, total, 'ms', 1_000)
    console.log('')
    console.log(\`wrote \${file}\`)
  }

  client.close()
}

await main()
