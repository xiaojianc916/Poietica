import type { AcpToolCallContent } from '@poietica/acp'

import { readSubAgent, type SubAgentBrief } from './sub-agent'
import { type DiffStat, type ToolContentPart, toToolCallView } from './tool-call-content'

/**
 * 一次工具调用的两个面：送出去的那一份，和交回来的那一份。
 *
 * ACP 的一条 tool_call 里本来就有 rawInput 与 rawOutput，而此前这一层只投影了
 * content —— 也就是只有「交回来的」。入参唯一一次露面是子代理那条特例：
 * 「不是子代理 / 已经有产出 / prompt 是空的」三者任一成立就看不到入参。
 * 一个只在一种工具、一种时刻下成立的入参视图不是视图，是补丁。
 *
 * 双面是这类界面的通行结构：Chrome DevTools 的 Network 面板分 Headers /
 * Payload / Response，Postman 是请求与响应两栏，模型厂商的 tool-call 检视器一律
 * input/output 对照。这里照这条来 —— 两个面恒定成立，谁有内容谁出现。
 *
 * 这一层不认识 React，也不认识时间线的条目类型：入参按形状收，与
 * tool-call-content 只依赖 @poietica/acp 是同一条边界。
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
  /** 产出为空时的回落：rawOutput 那一段围栏。两头都空就是 null。 */
  readonly output: string | null
  readonly parts: readonly ToolContentPart[]
  /** 入参那一面，已经是一段 json 围栏；上游没送入参就是 null。 */
  readonly request: string | null
}

/*
 * 入参画成 JSON，走的是这个应用里已经有的那条 markdown 管线。
 *
 * Prose 背后是 Streamdown + @streamdown/code（Shiki），而 prose.tsx 的 CONTROLS
 * 早就把代码块的复制按钮打开了。所以一段围栏进去，出来就带语法高亮、带复制、跟随
 * 主题、走官方那条静态解析路径 —— 不需要在这里手搓一个 <pre>，也不需要为它再引
 * 第二个高亮器。
 */
const FENCE_OPEN = '```json\n'
const FENCE_CLOSE = '\n```'

/*
 * 一次调用能有多大：edit 与 write 类工具的 rawInput 里装着整份文件正文。Shiki 的
 * 分词是线性的，但常数不小，而这张卡片挂在虚拟列表上。64 KiB 之后按行切断。
 */
const CAP = 64 * 1024

/*
 * 空信封不算一面：无参工具的 rawInput 常常就是一个 {}，为它开一个页签，读者点过去
 * 只会看到两个大括号。
 */
function isEmptyBag(value: object): boolean {
  return Array.isArray(value) ? value.length === 0 : Reflect.ownKeys(value).length === 0
}

function buildFence(value: unknown): string | null {
  /* stringify 对 undefined / 函数 / symbol 交回 undefined，声明里没写这一半。 */
  const text: string | undefined = JSON.stringify(value, null, 2)

  if (text === undefined) {
    return null
  }

  if (text.length <= CAP) {
    return `${FENCE_OPEN}${text}${FENCE_CLOSE}`
  }

  const cut = text.lastIndexOf('\n', CAP)

  return `${FENCE_OPEN}${text.slice(0, cut > 0 ? cut : CAP)}${FENCE_CLOSE}\n\n入参过长，上面只是开头。`
}

/*
 * 按入参对象记一次。
 *
 * 键取 rawInput 自己，与 toToolCallView 键取 content 数组同一条理由：一次调用在流式
 * 期间会换很多个条目对象，但它的入参从头到尾是同一个引用 —— 按条目记会让每收到一段
 * 产出就把整份入参重新序列化一遍。
 */
const FENCES = new WeakMap<object, string | null>()

function fenceOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'object') {
    return buildFence(value)
  }

  const held = FENCES.get(value)

  if (held !== undefined) {
    return held
  }

  const fence = isEmptyBag(value) ? null : buildFence(value)

  FENCES.set(value, fence)

  return fence
}

/** 两个面，一趟算完。渲染器只读不算。 */
export function toToolCallFacets(source: ToolCallFacetSource): ToolCallFacets {
  const { diffStat, parts } = toToolCallView(source.content)

  return {
    brief: readSubAgent(source.rawInput),
    diffStat,
    output: parts.length > 0 ? null : fenceOf(source.rawOutput),
    parts,
    request: fenceOf(source.rawInput),
  }
}
