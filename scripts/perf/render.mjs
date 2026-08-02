#!/usr/bin/env node
/**
 * 渲染层测量，全自动。
 *
 *   pnpm perf:render            # 无头，默认
 *   pnpm perf:render -- --headed
 *
 * 自己拉 vite、自己开 Edge（Windows 上和 WebView2 是同一个 Chromium 引擎）、
 * 自己接 CDP、自己采样、自己收摊。
 *
 * 默认无头有三个理由，都是踩出来的：有头启动会被 Chromium 的 singleton 转交给
 * 用户已经在跑的那个实例，于是 --user-data-dir 失效、扩展被带进来；扩展弹出的
 * 标签页会把谐调器挤到后台；后台标签页会被停发 requestAnimationFrame。
 *
 * 节拍由这边推进：一次 evaluate 让页面同步跑完整轮，不依赖浏览器调度器。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { connect, findPage, rankCpu, report, until } from './devtools.mjs'

const URL = 'http://localhost:1420/perf/index.html'
const PORT = 9333
const OUT = '.perf'

/** Edge 在 Windows 上的两个常规落点。别处的用 EDGE_BINARY 指。 */
const CANDIDATES = [
  process.env['EDGE_BINARY'],
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/**
 * vite 的编译失败只会以控制台消息的形式到达 —— 页面本身没崩，所以 error 事件
 * 不触发，__perfError 也不会被写。看见这些字样就等于已经拿到死因，再等下去
 * 纯属浪费；上一轮明明第一秒就打出了报错，却仍旧空等了六十秒。
 */
const COMPILE_FAILURE = ['Internal Server Error', 'Failed to resolve import', 'Pre-transform error']

/** Windows 上 pnpm 拉起的是一棵进程树，得连根拔。 */
function terminate(child) {
  if (child.pid === undefined || child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })

    return
  }

  child.kill('SIGTERM')
}

function describe(argument) {
  return argument.value ?? argument.description ?? argument.type
}

async function main() {
  const edge = CANDIDATES.find((path) => path !== undefined && existsSync(path))

  if (edge === undefined) {
    console.error('no edge binary found — set EDGE_BINARY to point at one')

    process.exitCode = 1

    return
  }

  const spawned = []

  try {
    console.log('starting vite')

    const vite = spawn('pnpm --filter @poietica/desktop exec vite', {
      shell: true,
      stdio: 'ignore',
    })

    spawned.push(vite)

    const served = await until(async () => (await fetch(URL)).ok, 60_000)

    if (served !== true) {
      console.error('vite never served ' + URL)

      process.exitCode = 1

      return
    }

    const profile = await mkdtemp(join(tmpdir(), 'poietica-perf-'))

    console.log('opening the harness')

    const browser = spawn(
      edge,
      [
        '--remote-debugging-port=' + String(PORT),
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        /* 扩展会抢焦点、开标签页，也会把自己的开销算进读数。 */
        '--disable-extensions',
        /* 就算有人用 --headed，也不能让节流再把测量停掉。 */
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--window-size=1200,900',
        ...(process.argv.includes('--headed') ? [] : ['--headless=new']),
        URL,
      ],
      { stdio: 'ignore' },
    )

    spawned.push(browser)

    const endpoint = 'http://127.0.0.1:' + String(PORT)
    const page = await until(() => findPage(endpoint, '/perf/'), 30_000)

    if (page === undefined) {
      console.error('the harness page never showed up on ' + endpoint)
      console.error('a stray edge instance may have taken the url — close edge and retry')

      process.exitCode = 1

      return
    }

    const client = connect(page.webSocketDebuggerUrl)

    await client.ready

    let broken = null

    /* 先挂监听，再 enable，最后重新加载 —— 顺序反了就收不到启动期的报错。 */
    client.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails
      const text = details.exception?.description ?? details.text

      broken = broken ?? text

      console.error('page threw: ' + text)
    })

    client.on('Runtime.consoleAPICalled', (params) => {
      const text = params.args.map(describe).join(' ')

      if (COMPILE_FAILURE.some((needle) => text.includes(needle))) {
        broken = broken ?? text
      }

      console.log('page: ' + text)
    })

    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await client.send('Page.reload', { ignoreCache: true })

    /* 确认连的确实是谐调器页，而不是碰巧存在的别的标签页。 */
    const ready = await until(async () => {
      if (broken !== null) {
        return { ready: false, error: broken }
      }

      const { result } = await client.send('Runtime.evaluate', {
        expression:
          'JSON.stringify({ ready: window.__perfReady === true, error: window.__perfError ?? null })',
        returnByValue: true,
      })

      const state = JSON.parse(result.value)

      return state.ready || state.error !== null ? state : undefined
    }, 60_000)

    if (ready === undefined) {
      console.error('the harness never became ready, and never said why')

      process.exitCode = 1

      return
    }

    if (ready.error !== null && ready.error !== undefined) {
      console.error('')
      console.error('the harness failed while loading:')
      console.error(ready.error)

      process.exitCode = 1

      return
    }

    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: 100 })
    await client.send('Profiler.start')

    console.log(
      'measuring — 40k chars, ' + String(Math.ceil(40_000 / 45)) + ' ticks, driven from here',
    )

    /*
     * 一次调用跑完整轮。节拍在这边，页面里没有任何调度器参与 —— 所以它不会被
     * 节流，也不会把 vsync 抖动混进读数。
     */
    const evaluated = await client.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__perfRun())',
      returnByValue: true,
      timeout: 300_000,
    })

    const { profile: cpu } = await client.send('Profiler.stop')

    client.close()

    if (evaluated.exceptionDetails !== undefined) {
      const details = evaluated.exceptionDetails

      console.error('')
      console.error('the harness failed:')
      console.error(details.exception?.description ?? details.text)

      process.exitCode = 1

      return
    }

    const measured = JSON.parse(evaluated.result.value)

    console.log('')
    console.log('  chars   ticks   render ms/tick   layout ms/tick')

    for (const bucket of measured.buckets) {
      console.log(
        String(bucket.length).padStart(7) +
          String(bucket.ticks).padStart(8) +
          bucket.render.toFixed(3).padStart(17) +
          bucket.layout.toFixed(3).padStart(17),
      )
    }

    console.log('')
    console.log('render 一列若随 chars 线性上涨，Prose 的 streaming 模式每拍重解析全文，')
    console.log('一条回答的总成本就是 O(T²)。持平则是我猜错了。')

    report(rankCpu(cpu), 'ms', 1_000)

    await mkdir(OUT, { recursive: true })

    const file = join(OUT, new Date().toISOString().replaceAll(/[:.]/gu, '-') + '.cpuprofile')

    await writeFile(file, JSON.stringify(cpu), 'utf8')

    console.log('')
    console.log('wrote ' + file)
  } finally {
    for (const child of spawned) {
      terminate(child)
    }
  }
}

await main()
