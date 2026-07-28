/*
 * AskUserQuestion —— 协议层。
 *
 * kimi-code（TS）的 AskUserQuestion 工具一次可携带 1–4 道题、每题 2–4 个选项，
 * 但它的 ACP adapter 目前把多题降级为单题（questionIndex 恒为 0，multi_select
 * 收窄成单选）。一道题在 wire 上就是一个 session/request_permission：
 *
 *   options: [
 *     { optionId: 'q0_opt_0', name: '<label>', kind: 'allow_once' },
 *     ...
 *     { optionId: 'q0_skip',  name: 'Skip',    kind: 'reject_once' },   // 自动追加
 *   ]
 *
 * 回包只能带一个 optionId；回 'q<N>_skip' 或 cancelled 都被 adapter 解成 null，
 * 也就是"用户跳过了这道题"。因此：
 *
 *   - 不做多选：回包带不回去。
 *   - 不做自由填写：工具侧没有这个通道。
 *   - 面板按 1/N 分页建模。今天 N 恒为 1；q(\d+)_ 命名空间是上游为多题预留的，
 *     等它放开，同一套 UI 直接生效，wire format 不变。
 */

export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

/**
 * 认得出「向用户提问」的方言。
 *
 * 提问不是 ACP 的概念：协议只有 session/request_permission。哪个 agent 用
 * 什么形状把一道题塞进权限请求，是那个 agent 的方言，所以它是一张表而不是
 * 两条写死的正则 —— 接第二个 ACP agent 是加一行，不是改判据。
 */
interface QuestionDialect {
  readonly option: RegExp
  readonly skip: RegExp
}

const DIALECTS: readonly QuestionDialect[] = [
  /* kimi-code 的 ACP adapter：q0_opt_0 / q0_skip。 */
  { option: /^q(\d+)_opt_(\d+)$/, skip: /^q(\d+)_skip$/ },
]

export type QuestionOptionId =
  | { readonly kind: 'option'; readonly questionIndex: number; readonly optionIndex: number }
  | { readonly kind: 'skip'; readonly questionIndex: number }

/** 解析 ACP optionId。不属于提问命名空间的一律返回 null。 */
export function parseQuestionOptionId(optionId: string): QuestionOptionId | null {
  for (const dialect of DIALECTS) {
    const option = dialect.option.exec(optionId)

    if (option) {
      return {
        kind: 'option',
        questionIndex: Number(option[1]),
        optionIndex: Number(option[2]),
      }
    }

    const skip = dialect.skip.exec(optionId)

    if (skip) {
      return { kind: 'skip', questionIndex: Number(skip[1]) }
    }
  }

  return null
}

export interface QuestionChoice {
  readonly optionId: string
  readonly label: string
}

export interface QuestionCard {
  /** 这道题对应的那个 permission 请求；答案按 requestId 回。 */
  readonly requestId: string
  readonly prompt: string
  /** 短分类标签（上游 header，≤12 字符）。没有就是空串。 */
  readonly header: string
  readonly choices: readonly QuestionChoice[]
  /** 跳过这道题用的 optionId。上游保证有，缺失时为 undefined。 */
  readonly skipOptionId: string | undefined
}

export interface QuestionDeck {
  /** 题组锚定的工具调用；时间线卡片挂在同一处。 */
  readonly toolCallId: string
  readonly cards: readonly QuestionCard[]
}

/**
 * 一个 pending 请求像不像 AskUserQuestion。
 *
 * 判据是 optionId 的形状，不是工具名：工具名在不同 agent / 版本下写法不一，
 * 而 q0_opt_0 / q0_skip 这套命名空间是 adapter 自己造的、稳定的。
 */
export function isQuestionRequest(request: {
  readonly options: readonly { readonly optionId: string; readonly kind?: string }[]
}): boolean {
  if (request.options.length === 0) {
    return false
  }

  /*
   * 形状对得上还不够，语义也要对得上。
   *
   * 一次真正的授权请求（写文件、跑命令）里总带着 allow_always / reject_always，
   * 而一道题只有「选它」和「跳过」。只认命名空间的话，optionId 恰好撞上这套
   * 形状的授权请求会被摘出流、画成一道选择题 —— 用户以为在答题，实际是在
   * 批准写盘。kind 是 ACP 自己的分类，比任何一家的私有命名都权威。
   *
   * kind 缺席时不否决：题组构建阶段只带着 optionId 与文案，那一层的语义
   * 已经在上游按完整的 PermissionOption 判过一次了。
   */
  return request.options.every((option) => {
    const parsed = parseQuestionOptionId(option.optionId)

    if (parsed === null) {
      return false
    }

    if (option.kind === undefined) {
      return true
    }

    return parsed.kind === 'skip' ? option.kind === 'reject_once' : option.kind === 'allow_once'
  })
}

/**
 * 把同一个工具调用下的若干 pending 提问请求聚成一副题组。
 *
 * 按 questionIndex 排序；同一个 index 只保留第一个（上游今天只发 index 0，
 * 重复出现说明是新一轮提问，由调用方按 toolCallId 分流）。
 */
export function buildQuestionDeck(
  toolCallId: string,
  requests: readonly {
    readonly requestId: string
    readonly prompt: string
    readonly header?: string | undefined
    readonly options: readonly { readonly optionId: string; readonly label: string }[]
  }[],
): QuestionDeck | null {
  const seen = new Set<number>()
  const ordered: { index: number; card: QuestionCard }[] = []

  for (const request of requests) {
    if (!isQuestionRequest(request)) {
      continue
    }

    const head = request.options[0]

    if (head === undefined) {
      continue
    }

    const first = parseQuestionOptionId(head.optionId)

    if (first === null || seen.has(first.questionIndex)) {
      continue
    }

    seen.add(first.questionIndex)

    const choices: QuestionChoice[] = []
    let skipOptionId: string | undefined

    for (const option of request.options) {
      const parsed = parseQuestionOptionId(option.optionId)

      if (parsed === null) {
        continue
      }

      if (parsed.kind === 'skip') {
        skipOptionId = option.optionId
        continue
      }

      choices.push({ optionId: option.optionId, label: option.label })
    }

    if (choices.length === 0) {
      continue
    }

    ordered.push({
      index: first.questionIndex,
      card: {
        requestId: request.requestId,
        prompt: request.prompt,
        header: request.header ?? '',
        choices,
        skipOptionId,
      },
    })
  }

  if (ordered.length === 0) {
    return null
  }

  ordered.sort((a, b) => a.index - b.index)

  return { toolCallId, cards: ordered.map((entry) => entry.card) }
}

/** 面板提交产出的东西：每道题一条，跳过的题用它自己的 skip。 */
export interface QuestionAnswer {
  readonly requestId: string
  readonly optionId: string
}
/*
 * 一道题真正的题面。
 *
 * permission 帧的 title 由 adapter 写死成 'AskUserQuestion'（session.ts 里就是
 * 一个字面量），问题本身被塞进 toolCall.content 的第一段文本。所以凡是要显示
 * 「问了什么」的地方都必须走这里，读 title 只能读到工具名。
 *
 * 参数按结构收，不绑 PermissionItem：这支函数的前提只有"有个 title、可能有个
 * toolCall.content"，绑死契约类型会让它跟着契约一起改。
 */

interface QuestionPromptSource {
  readonly title: string
  readonly toolCall?: { readonly content?: readonly unknown[] | undefined } | undefined
}

/** 取一条 toolCall content 里的纯文本；不是文本块就是空串。 */
function textOfContent(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) {
    return ''
  }

  const outer = entry as { readonly type?: unknown; readonly content?: unknown }

  if (outer.type !== 'content') {
    return ''
  }

  const inner = outer.content

  if (typeof inner !== 'object' || inner === null) {
    return ''
  }

  const block = inner as { readonly type?: unknown; readonly text?: unknown }

  if (block.type !== 'text' || typeof block.text !== 'string') {
    return ''
  }

  return block.text
}

export function readQuestionPrompt(request: QuestionPromptSource): string {
  for (const entry of request.toolCall?.content ?? []) {
    const text = textOfContent(entry).trim()

    if (text.length > 0) {
      return text
    }
  }

  return request.title
}
