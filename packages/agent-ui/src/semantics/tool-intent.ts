import type { ToolCallTimelineItem } from '@poietica/agent-timeline'

/**
 * 一次调用的意图：它要做什么。
 *
 * 这是三条轴里的第一条 —— 意图（要做什么）、过程（正在做什么）、产出（做出了什么）。
 * 上游内部有一份逐字对应的类型（kimi-code 的 tool/toolInputDisplay.ts），文件头注释
 * 明说这份提示存在的意义就是让审批面板和工具卡片「present it without re-deriving it
 * from raw arguments」。但它在 ACP 边界上只放行了 diff、file_io、plan_review 三种
 * （convert.ts 的 displayBlockToAcpContent，其余 return null），command、search、
 * url_fetch 一律丢掉 —— 我们收到的只剩一个 title: "Bash"。
 *
 * 所以这一份是照那个形状从 rawInput 重建的。rawInput 是完整的，意图没有真的丢。
 */

/**
 * 从入参里取意图的键名，按可靠度排序。
 *
 * description 排在最前，因为它不是从原料反推出来的意图，它就是意图本身 —— 调用方
 * 自己写下的那句话。Anthropic 的 Bash 工具 schema 对这个字段的定义原文是「Clear,
 * concise description of what this command does in 5-10 words」：它存在的唯一用途
 * 就是给界面显示，Claude Code 的 Bash 卡片显示的正是它。
 *
 * 这也正好补上本文件开头那段话缺的一角：上游 toolInputDisplay.ts 那份显示提示在 ACP
 * 边界上被丢掉了，而 description 是它唯一穿过边界活下来的字段。此前把它排在 command
 * 后面，等于捡了原料、丢了成品 —— 一屏卡片显示的是「curl.exe -s -X POST …」而不是
 * 「解析快照提取新闻标题」。
 *
 * 后面那一串仍是 kimi 的方言，是这份文件里唯一没有逐字验证过的东西：那份官方类型定义
 * 的是显示形状，不是各个工具的入参 schema。所以它被设计成安全失败 —— 一个键都对不上
 * 就交回 null，标题栏退回只有工具名的样子，绝不会显示一个错的意图。
 *
 * 接第二家 agent 时这一整块搬进 AgentDialect。现在只有一家，搬过去就是凭空多一层。
 */
const KEYS = [
  'description',
  'command',
  'pattern',
  'query',
  'url',
  'file_path',
  'filePath',
  'path',
] as const

/** 标题栏是一行。太长的先在这里截断，省得把整份文件内容塞进 DOM。 */
const CLAMP = 160

export type ToolIntent = {
  /** 画出来的那一行，已截断。 */
  readonly text: string
  /** 悬浮提示里的全文。 */
  readonly full: string
}

/** 只要第一行：多行命令在一行里画不下，而第一行通常就说清了是什么命令。 */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? ''

  return line.trim()
}

function intentOf(full: string): ToolIntent | null {
  const line = firstLine(full)

  if (line.length === 0) {
    return null
  }

  return { full: full.trim(), text: line.length > CLAMP ? `${line.slice(0, CLAMP)}…` : line }
}

/**
 * 入参是 unknown：它是 agent 递过来的原始 JSON，不是我们的类型。
 * 所以逐键取值、只认字符串，取不到就往下一个键走。
 */
function fromInput(rawInput: unknown): string | null {
  if (typeof rawInput !== 'object' || rawInput === null) {
    return null
  }

  for (const key of KEYS) {
    const value = Reflect.get(rawInput, key)

    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return null
}

/**
 * 退回协议原生的那一格。
 *
 * locations 是 ACP 自己的字段，不是方言，所以它比上面那串键名可靠。但它只覆盖认得
 * 路径的那些工具，而且抽屉里已经列过一遍 —— 这里只取第一处，剩下的报个数。
 */
function fromLocations(locations: ToolCallTimelineItem['locations']): string | null {
  const head = locations[0]

  if (head === undefined) {
    return null
  }

  const at = head.line === undefined ? head.path : `${head.path}:${String(head.line)}`

  return locations.length > 1 ? `${at} 等 ${String(locations.length)} 处` : at
}

/**
 * 这次调用要做什么，一行话。
 *
 * 交回 null 表示「说不出来」—— 那时标题栏保持原样，只有工具名。宁可少说一句，
 * 不肯说错一句。
 */
export function readToolIntent(
  item: Pick<ToolCallTimelineItem, 'locations' | 'rawInput'>,
): ToolIntent | null {
  const said = fromInput(item.rawInput) ?? fromLocations(item.locations)

  return said === null ? null : intentOf(said)
}
