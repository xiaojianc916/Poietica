import { applyRunEvents, createTimelineState, selectFeedRows } from '@poietica/agent-timeline'
import { TimelineRow } from '@poietica/agent-ui'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

/*
 * 渲染层的量尺。
 *
 * 走的全是真路径：真的 reducer、真的 selector、真的 TimelineRow（它自带
 * timeline.css，里面是真的 Prose 和 streamdown 的四个插件）。喂进去的是真实
 * 粒度的 chunk，顺序也和生产一致 —— 先 run_started，再流文本。
 *
 * 节拍不归这里管。整轮是一个同步函数，由驱动脚本调用一次跑完：不碰
 * requestAnimationFrame，不碰定时器，不经过浏览器的任何调度器 —— 上一版正是
 * 因为把节拍交给帧调度器，页面一进后台就被停发，测量永久停摆。
 *
 * 副作用是读数更干净：里面只剩 React 渲染与布局本身，没有 vsync 抖动，也没有
 * 合成器排队。要测的本来就是「这一拍花了多少 CPU」，不是「这一帧等了多久」。
 */

declare global {
  interface Window {
    __perfSay: (text: string) => void
    __perfFail: (reason: unknown) => void
    __perfReady?: boolean
    __perfRun?: () => unknown
  }
}

/** applyRunEvents 收什么，这里就造什么。从签名推导，不必跨层 import 类型。 */
type Event = Parameters<typeof applyRunEvents>[1][number]

/** 一段流式文本的典型长度。 */
const CHUNK = 45

/** 一篇长回答的规模。 */
const LENGTH = 40_000

/** 分桶宽度，按已生成的字符数。 */
const BUCKET = 4_000

/** 一段够真实的 markdown：段落、列表、行内代码、围栏、中英混排。 */
const SAMPLE = [
  '这一段是普通正文，中英混排 like this，用来让 lexer 真的有活干。\n\n',
  '- 列表项一，带 `inline code` 和 **强调**\n',
  '- 列表项二，带一个 [链接](https://example.com)\n\n',
  '```ts\nexport function measure(text: string): number {\n  return text.length\n}\n```\n\n',
  '> 引用一行，收尾。\n\n',
].join('')

function answer(): string {
  let text = ''

  while (text.length < LENGTH) {
    text += SAMPLE
  }

  return text.slice(0, LENGTH)
}

function started(seq: number): Event {
  return { kind: 'run_started', seq, at: 1_800_000_000_000, prompt: 'perf' } as Event
}

function chunk(seq: number, text: string): Event {
  return {
    kind: 'acp_update',
    seq,
    at: 1_800_000_000_000 + seq,
    notification: {
      sessionId: 'sess_perf',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    },
  } as Event
}

interface Sample {
  readonly length: number
  readonly render: number
  readonly layout: number
}

function summarise(samples: readonly Sample[]) {
  const buckets = new Map<number, { render: number; layout: number; count: number }>()

  for (const sample of samples) {
    const key = Math.floor(sample.length / BUCKET) * BUCKET
    const bucket = buckets.get(key) ?? { render: 0, layout: 0, count: 0 }

    bucket.render += sample.render
    bucket.layout += sample.layout
    bucket.count += 1
    buckets.set(key, bucket)
  }

  return [...buckets]
    .sort(([left], [right]) => left - right)
    .map(([length, bucket]) => ({
      length,
      ticks: bucket.count,
      render: bucket.render / bucket.count,
      layout: bucket.layout / bucket.count,
    }))
}

function sweep() {
  const host = document.querySelector('#root')

  if (host === null) {
    throw new Error('no #root')
  }

  const root = createRoot(host)
  const text = answer()
  const samples: Sample[] = []

  /* 先开一个 run，再流文本 —— 生产里就是这个顺序。 */
  let state = applyRunEvents(createTimelineState(), [started(1)])
  let seq = 1

  for (let cursor = 0; cursor < text.length; cursor += CHUNK) {
    seq += 1
    state = applyRunEvents(state, [chunk(seq, text.slice(cursor, cursor + CHUNK))])

    const row = selectFeedRows(state).at(-1)

    if (row === undefined) {
      throw new Error('the reducer produced no rows after ' + String(seq) + ' events')
    }

    /*
     * flushSync 把 React 的渲染拉回同步，量到的才是这一拍真正花掉的时间；
     * 之后强制读一次高度，把布局从异步里逼出来单独计价。
     */
    const opened = performance.now()

    flushSync(() => {
      root.render(<TimelineRow row={row} />)
    })

    const rendered = performance.now()

    void (host as HTMLElement).offsetHeight

    samples.push({
      length: cursor + CHUNK,
      render: rendered - opened,
      layout: performance.now() - rendered,
    })
  }

  return { buckets: summarise(samples), ticks: samples.length }
}

window.__perfRun = () => {
  window.__perfSay('measuring')

  try {
    const measured = sweep()

    window.__perfSay('done — ' + String(measured.ticks) + ' ticks')

    return measured
  } catch (error) {
    window.__perfFail(error instanceof Error ? (error.stack ?? error.message) : error)

    throw error
  }
}

/* 驱动靠这个字段确认自己连的确实是这一页，而不是别的标签页。 */
window.__perfReady = true
window.__perfSay('ready')
