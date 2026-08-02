#!/usr/bin/env node
/**
 * 连上正在运行的真实应用，采一段 CPU 或堆分配剖面。
 *
 * 注意是 tauri dev，不是 dev —— 后者只起一个 Vite 开发服务器，根本没有 WebView。
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
 *   pnpm tauri dev
 *
 * 然后另开一个终端：
 *
 *   pnpm perf:profile              # CPU，默认 15 秒
 *   pnpm perf:profile -- --heap    # 堆分配归因
 *   pnpm perf:profile -- --seconds 30
 *
 * 这一把量的是真实会话里的真实负载，所以需要你在采样期间让 agent 说话。要一份
 * 不需要人、可复现、可回归的数字，用 pnpm perf:render。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, findPage, rankCpu, rankHeap, report } from './devtools.mjs'

const OUT = '.perf'

function option(name, fallback) {
  const at = process.argv.indexOf('--' + name)

  return at === -1 ? fallback : Number(process.argv[at + 1] ?? fallback)
}

async function main() {
  const endpoint = process.env['POIETICA_DEVTOOLS'] ?? 'http://127.0.0.1:9222'
  const page = await findPage(endpoint).catch(() => undefined)

  if (page === undefined) {
    console.error('no webview at ' + endpoint)
    console.error('')
    console.error('  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"')
    console.error('  pnpm tauri dev')

    process.exitCode = 1

    return
  }

  const seconds = option('seconds', 15)
  const heap = process.argv.includes('--heap')
  const client = connect(page.webSocketDebuggerUrl)

  await client.ready
  await mkdir(OUT, { recursive: true })

  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')

  if (heap) {
    await client.send('HeapProfiler.enable')
    await client.send('HeapProfiler.startSampling', { samplingInterval: 16_384 })

    console.log('sampling allocations for ' + String(seconds) + 's')

    await sleep(seconds * 1_000)

    const { profile } = await client.send('HeapProfiler.stopSampling')
    const file = join(OUT, stamp + '.heapprofile')

    await writeFile(file, JSON.stringify(profile), 'utf8')

    report(rankHeap(profile.head), 'MB', 1_048_576)

    console.log('')
    console.log('wrote ' + file)
  } else {
    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: 100 })
    await client.send('Profiler.start')

    console.log('sampling cpu for ' + String(seconds) + 's')

    await sleep(seconds * 1_000)

    const { profile } = await client.send('Profiler.stop')
    const file = join(OUT, stamp + '.cpuprofile')

    await writeFile(file, JSON.stringify(profile), 'utf8')

    report(rankCpu(profile), 'ms', 1_000)

    console.log('')
    console.log('wrote ' + file)
  }

  client.close()
}

await main()
