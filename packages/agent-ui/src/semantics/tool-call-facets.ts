import type { AcpToolCallContent } from '@poietica/acp'

import { readSubAgent, type SubAgentBrief } from './sub-agent'
import { type DiffStat, type ToolContentPart, toToolCallView } from './tool-call-content'

/**
 * 一次工具调用的两个面：送出去的那一份，和交回来的那一份。
 *
 * 两个面交出去的都是 markdown，因为渲染它们的只有一条管线（Streamdown + Shiki，
 * 抽屉里由样式摘掉围栏的外壳）。这一层只负责说清楚「这一段是什么」。
 *
 * ## 入参不是一份 JSON 文档，是一组参数
 *
 * 此前这里是 JSON.stringify(rawInput, null, 2)。那一步在把数据变成 JSON 源码，而
 * JSON 的编码规则规定：字符串里的真换行写成 \\n，反斜杠写成两个，引号写成 \\"。
 * 于是一条 15 行的命令在屏幕上是一坨转义符，一个 Windows 路径印出双反斜杠 ——
 * stringify 没有错，错的是让人去读线路编码。JSON 是传输格式，不是呈现格式。
 *
 * 专业软件在这一格的做法一致：DevTools 的 Payload 面板默认是 parsed 视图（一行一个
 * 字段、值已解码），view source 是次要选项；Anthropic Console 的 tool_use、OpenAI
 * Playground、Claude Code、Cursor、Zed 的 agent 面板全部按具名参数渲染。所以这里也
 * 按参数渲染：标量一行，多行或过长的字符串独占一块围栏，嵌套结构才回到 JSON —— 因为
 * 那时候 JSON 确实是它天然的形状。
 *
 * ## 语言从扩展名来，而扩展名直接交给 Shiki
 *
 * Shiki 的 language alias 表里本来就收着 ts / tsx / py / rs / sh / yml 这些扩展名。
 * 所以这里不做 ext → lang 的翻译，只做一次准入：认得的原样交出去，认不得的一律 text。
 * 自己维护一张映射表，就是在上游那张表旁边再放一张会过期的。
 *
 * 这一层不认识 React，也不认识时间线的条目类型：入参按形状收，与 tool-call-content
 * 只依赖 @poietica/acp 是同一条边界。
 */

/** 画这两个面需要的全部原料；ToolCallTimelineItem 天然满足它。 */
export interface ToolCallFacetSource {
  readonly content: readonly AcpToolCallContent[]
  /** 这次调用要碰的文件。只取 path —— 行号是标题栏与编辑器的事，不是这一面的事。 */
  readonly locations?: readonly { readonly path: string }[]
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
}

export interface ToolCallFacets {
  /** 这次派发的任务书概要；不是子代理派发就是 null。 */
  readonly brief: SubAgentBrief | null
  readonly diffStat: DiffStat | null
  /**
   * 产出只是一句回执。
   *
   * Write 这类调用的服务端答复常常是「Wrote 127 bytes to …」—— 一行确认，而这次
   * 调用真正的内容在入参里。把回执换成文件内容是 UI 在伪造响应（DevTools 不会把
   * POST body 印进 Response 面板），但默认停在哪一面是可以由它来定的。
   *
   * 判据是形状，不是工具名：单行、短、没有围栏。
   */
  readonly isReceipt: boolean
  /** 送出去的那一面，一段 markdown；上游没送入参就是 null。 */
  readonly request: string | null
  /** 交回来的那一面，一段 markdown；什么都还没有就是 null。 */
  readonly response: string | null
}

/*
 * 一次调用能有多大：edit 与 write 类工具的入参里装着整份文件正文，抓页面的产出装着
 * 一整篇 DOM 文本。Shiki 的分词是线性的，但常数不小。64 KiB 之后按行截断。
 *
 * 这个上限与虚拟化不是一件事，两个都要：虚拟化省的是「这一帧要画多少」，它省的是
 * 「这段文本值不值得留在内存里被切成块」。
 */
const CAP = 64 * 1024

/** 一个值长到这个数就不再挤在行里，独占一块。约等于一行能容下的字符数。 */
const INLINE_MAX = 96

/** 一句回执的上限。超过这个长度的单行已经是内容，不是确认。 */
const RECEIPT_MAX = 160

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
 * 固定写三个是一个真实的缺口：工具输出里出现三连反引号一点都不罕见（读一份
 * markdown、抓一个页面、让子代理写文档），而 CommonMark 规定闭合围栏不短于开启
 * 围栏 —— 正文里那一行会把围栏提前收口，后面半段掉出去当散文渲染。
 */
function railFor(body: string, floor: number): string {
  const runs = body.match(/`+/g)
  let longest = 0

  if (runs !== null) {
    for (const run of runs) {
      longest = Math.max(longest, run.length)
    }
  }

  return '`'.repeat(Math.max(floor, longest + 1))
}

/** 一块带语言标注的围栏。info string 是 CommonMark 的官方语法，Shiki 认的就是它。 */
function block(lang: string, body: string): string {
  const text = clamp(body)
  const rail = railFor(text, 3)

  return `${rail}${lang}\n${text}\n${rail}`
}

/**
 * 一个值印在行里。
 *
 * 走行内代码而不是裸文本，是为了让反斜杠原样留下：markdown 的正文会把 \\ 当转义
 * 前缀吃掉，一个 Windows 路径印出来就少一半分隔符。行内代码里不发生任何转义。
 *
 * 首尾贴着反引号或空白时补一个空格 —— 那是 CommonMark 对行内代码定的规则，补上的
 * 空格由解析器自己吃掉，不会出现在屏幕上。
 */
function inlineCode(value: string): string {
  if (value === '') {
    return '`""`'
  }

  const rail = railFor(value, 1)
  const pad = value.startsWith('`') || value.endsWith('`') || value.trim() !== value ? ' ' : ''

  return `${rail}${pad}${value}${pad}${rail}`
}

/*
 * Shiki 注册的语言别名里本来就有这些扩展名，所以准入表里放的是扩展名本身，不做翻译。
 * 认不得的一律 text：Shiki 对未注册的 info string 会整块降级，那比猜错语言更安全。
 */
const SHIKI_ALIASES: ReadonlySet<string> = new Set([
  'astro',
  'bash',
  'c',
  'cpp',
  'cs',
  'css',
  'diff',
  'go',
  'graphql',
  'hs',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'json5',
  'jsonc',
  'jsx',
  'kt',
  'less',
  'lua',
  'md',
  'mdx',
  'php',
  'ps1',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
])

/** 这次调用碰的是什么文件，就按什么语言上色。协议给的信息，不是猜的。 */
function langOf(locations: ToolCallFacetSource['locations']): string {
  const path = locations?.[0]?.path

  if (path === undefined) {
    return 'text'
  }

  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()

  return SHIKI_ALIASES.has(ext) ? ext : 'text'
}

/**
 * 一段字节是不是 JSON。
 *
 * 判据与 DevTools 在没有 content-type 时用的一样：形状对得上，而且真的解析得动。
 * 只看 JSON.parse 会把一行 123 的日志也认成 JSON。
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

function textBlock(text: string, lang: string): string {
  const json = reflowJson(text)

  return json === null ? block(lang, text) : block('json', json)
}

function jsonBlock(value: unknown): string | null {
  /* stringify 对 undefined / 函数 / symbol 交回 undefined，声明里没写这一半。 */
  const text: string | undefined = JSON.stringify(value, null, 2)

  return text === undefined ? null : block('json', text)
}

function isOneLiner(text: string): boolean {
  const line = text.trim()

  return !line.includes('\n') && line.length <= RECEIPT_MAX
}

/* ── 送出去的那一面 ───────────────────────────────────────── */

/* 空信封不算一面：无参工具的入参常常就是一个 {}，为它开一个页签只会给出两个大括号。 */
function isEmptyBag(value: object): boolean {
  return Array.isArray(value) ? value.length === 0 : Reflect.ownKeys(value).length === 0
}

/** 一个值该不该独占一块：带换行的，或者长到一行放不下的。 */
function needsBlock(value: string): boolean {
  return value.includes('\n') || value.length > INLINE_MAX
}

function requestOf(source: ToolCallFacetSource, lang: string): string | null {
  const bag = source.rawInput

  if (bag === undefined || bag === null) {
    return null
  }

  if (typeof bag !== 'object') {
    return inlineCode(String(bag))
  }

  if (isEmptyBag(bag)) {
    return null
  }

  /* 顶层是数组的入参没有参数名可言，JSON 就是它天然的形状。 */
  if (Array.isArray(bag)) {
    return jsonBlock(bag)
  }

  const rows: string[] = []
  const blocks: string[] = []
  const printed = new Set<string>()

  for (const [key, value] of Object.entries(bag)) {
    if (value === undefined) {
      continue
    }

    if (typeof value === 'string') {
      if (needsBlock(value)) {
        blocks.push(`**${inlineCode(key)}**\n\n${textBlock(value, lang)}`)
        continue
      }

      printed.add(value)
      rows.push(`${inlineCode(key)} ${inlineCode(value)}`)
      continue
    }

    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      rows.push(`${inlineCode(key)} ${inlineCode(String(value))}`)
      continue
    }

    const nested = jsonBlock(value)

    if (nested !== null) {
      blocks.push(`**${inlineCode(key)}**\n\n${nested}`)
    }
  }

  /*
   * 受影响的文件排在最前：它说的是这次调用要碰什么，那是意图，不是结果。已经作为
   * 某个参数的值印过的路径不再印第二遍 —— 同一个路径在同一面出现两次是纯冗余。
   */
  const marks = (source.locations ?? [])
    .filter((location) => !printed.has(location.path))
    .map((location) => inlineCode(location.path))

  const head = marks.length > 0 ? [marks.join(' · ')] : []
  const body = rows.length > 0 ? [rows.join('\n\n')] : []
  const all = [...head, ...body, ...blocks]

  return all.length === 0 ? null : all.join('\n\n')
}

/* ── 交回来的那一面 ───────────────────────────────────────── */

function mark(text: string, sign: string): string {
  return text
    .split('\n')
    .map((line) => `${sign}${line}`)
    .join('\n')
}

/**
 * 一处改动，写成统一 diff。
 *
 * Shiki 的 diff 语法认的就是行首这两个符号 —— GitHub、VS Code、Zed 画 diff 用的都是
 * 它。而且这张样式表早已为它付过款：timeline.css 里 pre code span 那条写着
 * background-color: var(--sdm-tbg, transparent)，注释逐字说「少数 token 自带底色
 *（diff、命中标记）」。能力一直通着，此前旁边却另画了一套红绿。
 */
function diffBody(oldText: string | null, newText: string): string {
  const added = mark(newText, '+')

  return oldText === null ? added : `${mark(oldText, '-')}\n${added}`
}

function partMarkdown(part: ToolContentPart, lang: string): string {
  if (part.type === 'text') {
    return textBlock(part.text, 'text')
  }

  if (part.type === 'diff') {
    return `${inlineCode(part.path)}\n\n${block('diff', diffBody(part.oldText, part.newText))}`
  }

  if (part.type === 'terminal') {
    return `终端 ${inlineCode(part.terminalId)}`
  }

  return part.label
}

interface Response {
  readonly isReceipt: boolean
  readonly markdown: string | null
}

function responseOf(parts: readonly ToolContentPart[], rawOutput: unknown, lang: string): Response {
  if (parts.length > 0) {
    const only = parts.length === 1 ? parts[0] : undefined

    return {
      isReceipt: only?.type === 'text' && isOneLiner(only.text),
      markdown: parts.map((part) => partMarkdown(part, lang)).join('\n\n'),
    }
  }

  /* 协议只给了 rawOutput 的时候，它就是这一面唯一交得出来的东西。 */
  if (typeof rawOutput === 'string') {
    return {
      isReceipt: isOneLiner(rawOutput),
      markdown: rawOutput === '' ? null : textBlock(rawOutput, 'text'),
    }
  }

  if (rawOutput === undefined || rawOutput === null) {
    return { isReceipt: false, markdown: null }
  }

  return { isReceipt: false, markdown: jsonBlock(rawOutput) }
}

/**
 * 两个面，一趟算完。渲染器只读不算。
 *
 * 交出去的是字符串而不是一份对象树，所以这一层不需要一张 WeakMap：同样内容的字符串
 * 逐字相等，下游那几个 useMemo 的依赖比较照样命中。
 */
export function toToolCallFacets(source: ToolCallFacetSource): ToolCallFacets {
  const { diffStat, parts } = toToolCallView(source.content)
  const lang = langOf(source.locations)
  const response = responseOf(parts, source.rawOutput, lang)

  return {
    brief: readSubAgent(source.rawInput),
    diffStat,
    isReceipt: response.isReceipt,
    request: requestOf(source, lang),
    response: response.markdown,
  }
}
