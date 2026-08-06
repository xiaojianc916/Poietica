import type { AcpToolCallContent } from '@poietica/acp'

import { readSubAgent, type SubAgentBrief } from './sub-agent'
import { type DiffStat, type ToolContentPart, toToolCallView } from './tool-call-content'

/**
 * 一次工具调用的两个面：送出去的那一份，和交回来的那一份。
 *
 * 两个面交出去的都是 markdown，因为渲染它们的只有一条管线 —— 带语言标注的围栏交给
 * Streamdown，Shiki 上色，围栏的外壳（语言胶囊、复制按钮、内框）由样式在抽屉作用域
 * 里摘掉。这一层只负责说清楚「这一段是什么」。
 *
 * ## 入参就是入参的 JSON
 *
 * 曾经试过把它拆成一行行具名参数（标量一行、长文本一块）。那是 DevTools Payload 面板
 * 的 parsed 视图，读单个字段确实更快，但它把「这次到底送出去了什么」这件事拆散了 ——
 * 而抽屉里的这一面要回答的正是这一件事。所以这里回到 JSON.stringify(value, null, 2)：
 * 一份完整、可比对、可原样复制的请求体，和 DevTools 的 view source、Postman 的 Pretty、
 * jq 的默认输出是同一个东西。
 *
 * 随之而来的转义不是缺陷，是语法：JSON 里字符串中的反斜杠写成两个、换行写成 \\n
 *（RFC 8259 §7）。任何显示 JSON 源码的工具都这样，想看解码后的值就只能不显示 JSON。
 * 这一面显示的是 JSON。
 *
 * ## 一次写入交回来的应该是那份内容
 *
 * ACP 规定 edit 类调用回传一段 diff（AcpToolCallContent 的 diff 分支），可实际拿到的
 * 常常只有一句「Wrote 127 bytes to …」—— 那是确认，不是结果。Cursor、Cline、Claude
 * Code 在这一格都不等服务端：它们从入参自己合成那份内容。这里同理，判据全部来自协议，
 * 不认工具名。见 writtenOf。
 *
 * 这一层不认识 React，也不认识时间线的条目类型：入参按形状收，与 tool-call-content
 * 只依赖 @poietica/acp 是同一条边界。
 */

/** 画这两个面需要的全部原料；ToolCallTimelineItem 天然满足它。 */
export interface ToolCallFacetSource {
  readonly content: readonly AcpToolCallContent[]
  /** ACP 的工具类别枚举。edit 那一支决定要不要为它合成写入的内容。 */
  readonly kind?: string
  /** 这次调用要碰的文件。只取 path —— 行号是标题栏与编辑器的事。 */
  readonly locations?: readonly { readonly path: string }[]
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
 * 一次调用能有多大：edit 与 write 类工具的入参里装着整份文件正文，抓页面的产出装着
 * 一整篇 DOM 文本。Shiki 的分词是线性的，但常数不小。64 KiB 之后按行截断。
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
 * 固定写三个是一个真实的缺口：工具输出里出现三连反引号一点都不罕见（读一份 markdown、
 * 抓一个页面、让子代理写文档），而 CommonMark 规定闭合围栏不短于开启围栏 —— 正文里
 * 那一行会把围栏提前收口，后面半段掉出去当散文渲染。
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
 * 走行内代码而不是裸文本，是为了让反斜杠原样留下：markdown 的正文会把它当转义前缀
 * 吃掉，一个 Windows 路径印出来就少一半分隔符。行内代码里不发生任何转义。
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
 * 自己维护一张 ext → lang 的映射，就是在上游那张表旁边再放一张会过期的。认不得的一律
 * text：Shiki 对未注册的 info string 会整块降级，那比猜错语言更安全。
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

/* ── 送出去的那一面 ───────────────────────────────────────── */

/* 空信封不算一面：无参工具的入参常常就是一个 {}，为它开一个页签只会给出两个大括号。 */
function isEmptyBag(value: object): boolean {
  return Array.isArray(value) ? value.length === 0 : Reflect.ownKeys(value).length === 0
}

function requestOf(source: ToolCallFacetSource): string | null {
  const bag = source.rawInput

  if (bag === undefined || bag === null) {
    return null
  }

  if (typeof bag === 'object' && isEmptyBag(bag)) {
    return null
  }

  const json = jsonBlock(bag)

  if (json === null) {
    return null
  }

  /*
   * 受影响的文件排在 JSON 前面：它说的是这次调用要碰什么，那是意图，不是结果 ——
   * 编辑器拿它做的也正是「跟着 agent 的视线走」。走行内代码，所以路径里的反斜杠是
   * 真的反斜杠，与下面 JSON 里那份编码过的各归各位。
   */
  const marks = (source.locations ?? []).map((location) => inlineCode(location.path))

  return marks.length === 0 ? json : `${marks.join(' · ')}\n\n${json}`
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

function partMarkdown(part: ToolContentPart): string {
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

/** 协议只给了 rawOutput 的时候，它就是这一面唯一交得出来的东西。 */
function outputOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value === '' ? null : textBlock(value, 'text')
  }

  return jsonBlock(value)
}

/**
 * 这次写进去的是什么。
 *
 * 「Wrote 127 bytes to …」是一句确认，不是这次调用的结果 —— 结果是那份内容。协议本来
 * 有位置放它（AcpToolCallContent 的 diff 分支），只是不少服务端不填。所以这里自己从
 * 入参合成，与 Cursor / Cline / Claude Code 在同一格的做法一致。
 *
 * 三条判据都来自协议或形状，一条都不认工具名：
 *   kind === 'edit'        —— ACP 的 AcpToolKind 枚举，卡片的图标分流用的也是它；
 *   产出里没有 diff        —— 服务端已经给了就不必代劳，那份才是权威；
 *   入参里最长的字符串     —— 一次写入的入参只有路径和内容两样，路径已被排除。
 */
function writtenOf(source: ToolCallFacetSource, parts: readonly ToolContentPart[]): string | null {
  if (source.kind !== 'edit') {
    return null
  }

  for (const part of parts) {
    if (part.type === 'diff') {
      return null
    }
  }

  const bag = source.rawInput

  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) {
    return null
  }

  const path = source.locations?.[0]?.path
  let body: string | null = null

  for (const value of Object.values(bag)) {
    if (typeof value !== 'string' || value === path || value === '') {
      continue
    }

    if (body === null || value.length > body.length) {
      body = value
    }
  }

  return body === null ? null : textBlock(body, langOf(source.locations))
}

function responseOf(source: ToolCallFacetSource, parts: readonly ToolContentPart[]): string | null {
  const pieces: string[] = parts.map((part) => partMarkdown(part))

  if (pieces.length === 0) {
    const output = outputOf(source.rawOutput)

    if (output !== null) {
      pieces.push(output)
    }
  }

  const written = writtenOf(source, parts)

  if (written !== null) {
    pieces.push(written)
  }

  return pieces.length === 0 ? null : pieces.join('\n\n')
}

/**
 * 两个面，一趟算完。渲染器只读不算。
 *
 * 交出去的是字符串而不是一份对象树，所以这一层不需要一张 WeakMap：同样内容的字符串
 * 逐字相等，下游那几个 useMemo 的依赖比较照样命中。
 */
export function toToolCallFacets(source: ToolCallFacetSource): ToolCallFacets {
  const { diffStat, parts } = toToolCallView(source.content)

  return {
    brief: readSubAgent(source.rawInput),
    diffStat,
    request: requestOf(source),
    response: responseOf(source, parts),
  }
}
