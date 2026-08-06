import type { AcpToolCallContent } from '@poietica/acp'

import { readSubAgent, type SubAgentBrief } from './sub-agent'
import { type DiffStat, type ToolContentPart, toToolCallView } from './tool-call-content'

/**
 * 一次工具调用的两个面：送出去的那一份，和交回来的那一份。
 *
 * ACP 的一条 tool_call 里本来就有 rawInput 与 rawOutput，而此前这一层只投影了
 * content —— 也就是只有「交回来的」。双面是这类界面的通行结构：Chrome DevTools 的
 * Network 面板分 Headers / Payload / Response，Postman 是请求与响应两栏，模型厂商的
 * tool-call 检视器一律 input/output 对照。
 *
 * 两个面交出去的都是 markdown，因为渲染它们的只有一条管线。
 *
 * 这句话此前只对一半：入参走围栏，产出却被当成散文直接喂进 markdown 解析器。可工具
 * 交回来的是字节，不是文章 —— CommonMark 的软换行把每一个换行折成空格，GFM 的
 * autolink 把 URL 变成蓝链，一段带竖线的输出会变成一张表格。屏幕上那团挤在一起的
 * 字不是排版没调好，是内容被它碰巧含有的标记字符解释了一遍。
 *
 * 所以产出也进围栏，而且用同一个函数造。带语言标注的围栏是 Streamdown 认得的东西，
 * Shiki 因此照常上色、换行照常保留 —— 需要的能力依赖里全都有，这一层只负责说清楚
 * 「这一段是什么」：解析得动的 JSON 就是 json 并重新缩进，diff 就是 diff，其余是 text。
 *
 * 外壳（语言胶囊、复制按钮、内框）不在这里关，那是样式的事：同一个围栏出现在回答里
 * 需要那身外壳，出现在抽屉里不需要 —— 判据是它在哪，不是它是什么。
 *
 * 这一层不认识 React，也不认识时间线的条目类型：入参按形状收，与 tool-call-content
 * 只依赖 @poietica/acp 是同一条边界。
 */

/** 画这两个面需要的全部原料；ToolCallTimelineItem 天然满足它。 */
export interface ToolCallFacetSource {
  readonly content: readonly AcpToolCallContent[]
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
}

export interface ToolCallFacets {
  /** 这次派发的任务书概要；不是子代理派发就是 null。 */
  readonly brief: SubAgentBrief | null
  readonly diffStat: DiffStat | null
  /** 送出去的那一面，一段 markdown；上游没送入参就是 null。 */
  readonly request: string | null
  /** 交回来的那一面，一段 markdown；什么都还没有就是 null。 */
  readonly response: string | null
}

/*
 * 一次调用能有多大：edit 与 write 类工具的 rawInput 里装着整份文件正文，抓页面的
 * rawOutput 装着一整篇 DOM 文本。Shiki 的分词是线性的，但常数不小。64 KiB 之后按行截断。
 *
 * 这个上限与虚拟化不是一件事，两个都要：虚拟化省的是「这一帧要画多少」，它省的是
 * 「这段文本值不值得留在内存里被切成块」。
 */
const CAP = 64 * 1024

function clamp(text: string): string {
  if (text.length <= CAP) {
    return text
  }

  const cut = text.lastIndexOf('\n', CAP)

  return `${text.slice(0, cut > 0 ? cut : CAP)}\n…（内容过长，上面只是开头）`
}

/**
 * 围栏得比正文里最长的那串反引号还长一格。
 *
 * 固定写三个是一个真实的缺口：工具输出里出现 \`\`\` 一点都不罕见（读一份 markdown、
 * 抓一个页面、让子代理写文档），而 CommonMark 规定闭合围栏不短于开启围栏 —— 正文里
 * 那一行会把围栏提前收口，后面半段掉出去当散文渲染。这是官方语法的一条规则，不是
 * 一个边角情况。
 */
function railFor(body: string): string {
  const runs = body.match(/`+/g)
  let longest = 0

  if (runs !== null) {
    for (const run of runs) {
      longest = Math.max(longest, run.length)
    }
  }

  return '`'.repeat(Math.max(3, longest + 1))
}

function block(lang: string, body: string): string {
  const text = clamp(body)
  const rail = railFor(text)

  return `${rail}${lang}\n${text}\n${rail}`
}

/**
 * 一段字节是不是 JSON。
 *
 * 判据与 DevTools 在没有 content-type 时用的一样：形状对得上，而且真的解析得动。
 * 只看 JSON.parse 会把一行 \"123\" 的日志也认成 JSON。
 */
function reflowJson(text: string): string | null {
  const head = text.trimStart()

  if (!head.startsWith('{') && !head.startsWith('[')) {
    return null
  }

  try {
    return JSON.stringify(JSON.parse(head), null, 2)
  } catch {
    return null
  }
}

function textBlock(text: string): string {
  const json = reflowJson(text)

  return json === null ? block('text', text) : block('json', json)
}

function jsonBlock(value: unknown): string | null {
  /* stringify 对 undefined / 函数 / symbol 交回 undefined，声明里没写这一半。 */
  const text: string | undefined = JSON.stringify(value, null, 2)

  return text === undefined ? null : block('json', text)
}

function mark(text: string, sign: string): string {
  return text
    .split('\n')
    .map((line) => `${sign}${line}`)
    .join('\n')
}

/**
 * 一处改动，写成统一 diff。
 *
 * 此前它是两个自绘的色块（.timeline-tool__diff-old / __diff-new），而 Shiki 的 diff
 * 语法认的就是行首这两个符号 —— GitHub、VS Code、Zed 画 diff 用的都是它。而且这张
 * 样式表早已为它付过款：timeline.css 里 \"pre code span\" 那条写着
 * background-color: var(--sdm-tbg, transparent)，注释逐字说「少数 token 自带底色
 *（diff、命中标记）」。能力一直通着，旁边却另画了一套。
 */
function diffBlock(oldText: string | null, newText: string): string {
  const added = mark(newText, '+')

  return oldText === null ? added : `${mark(oldText, '-')}\n${added}`
}

function partMarkdown(part: ToolContentPart): string {
  if (part.type === 'text') {
    return textBlock(part.text)
  }

  if (part.type === 'diff') {
    return `\`${part.path}\`\n\n${block('diff', diffBlock(part.oldText, part.newText))}`
  }

  if (part.type === 'terminal') {
    return `终端 \`${part.terminalId}\``
  }

  return part.label
}

/*
 * 空信封不算一面：无参工具的 rawInput 常常就是一个 {}，为它开一个页签，读者点过去
 * 只会看到两个大括号。
 */
function isEmptyBag(value: object): boolean {
  return Array.isArray(value) ? value.length === 0 : Reflect.ownKeys(value).length === 0
}

function requestOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'object' && isEmptyBag(value)) {
    return null
  }

  return jsonBlock(value)
}

/** 协议只给了 rawOutput 的时候，它就是这一面唯一交得出来的东西。 */
function outputOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value === '' ? null : textBlock(value)
  }

  return jsonBlock(value)
}

/**
 * 两个面，一趟算完。渲染器只读不算。
 *
 * 交出去的是字符串而不是一份对象树，所以这一层不需要一张 WeakMap：同样内容的字符串
 * 逐字相等，下游那几个 useMemo 的依赖比较照样命中 —— 此前那张按 rawInput 记账的表
 * 因此一起去掉了。
 */
export function toToolCallFacets(source: ToolCallFacetSource): ToolCallFacets {
  const { diffStat, parts } = toToolCallView(source.content)

  return {
    brief: readSubAgent(source.rawInput),
    diffStat,
    request: requestOf(source.rawInput),
    response:
      parts.length > 0
        ? parts.map((part) => partMarkdown(part)).join('\n\n')
        : outputOf(source.rawOutput),
  }
}
