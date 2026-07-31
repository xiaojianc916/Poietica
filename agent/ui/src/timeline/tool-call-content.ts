import type { AcpToolCallContent } from '@poietica/agent-protocol'
import { diffLines } from 'diff'

/**
 * The protocol envelope, flattened into things a card can draw.
 *
 * Kept separate from the component and free of React on purpose: what a tool
 * call shows is a decision worth testing against a real recording, while how it
 * is laid out is not.
 *
 * Content blocks other than text are named rather than rendered. Guessing at
 * the shape of an image or a resource block is what produced the last defect;
 * these get drawn when a recording contains one.
 */

export type ToolContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'diff'
      readonly path: string
      readonly oldText: string | null
      readonly newText: string
    }
  | { readonly type: 'terminal'; readonly terminalId: string }
  | { readonly type: 'opaque'; readonly label: string }

const OPAQUE_LABELS: Record<string, string> = {
  image: '一张图片',
  resource: '一段嵌入资源',
  resource_link: '一个资源链接',
}

export function toToolContentParts(
  content: readonly AcpToolCallContent[] | null | undefined,
): readonly ToolContentPart[] {
  if (content === undefined || content === null) {
    return []
  }

  const parts: ToolContentPart[] = []

  for (const entry of content) {
    if (entry.type === 'diff') {
      parts.push({
        type: 'diff',
        path: entry.path,
        oldText: entry.oldText ?? null,
        newText: entry.newText,
      })
      continue
    }

    if (entry.type === 'terminal') {
      parts.push({ type: 'terminal', terminalId: entry.terminalId })
      continue
    }

    const block = entry.content

    if (block.type === 'text') {
      /* A tool call opens with an empty string and fills in as arguments
         stream. An empty bubble is noise, not information. */
      if (block.text.length > 0) {
        parts.push({ type: 'text', text: block.text })
      }
      continue
    }

    parts.push({ type: 'opaque', label: OPAQUE_LABELS[block.type] ?? '一段内容' })
  }

  return parts
}

export interface DiffStat {
  readonly added: number
  readonly removed: number
}

/**
 * 这次调用改了多少行。
 *
 * 只有真的带了 diff 才有答案：读文件、搜索、跑终端都不是改动，给它们挂一个
 * +0 −0 的徽章是在制造噪音。协议给的是改动前后的整份文本，所以行级增删是一次
 * 真实比对的结果，不是拿行数相减估出来的 —— 那会把"改了一行"读成"没动过"。
 *
 * 比对交给 jsdiff：Myers 差分是有标准答案的问题，手写一份只会多一份要维护的
 * 边界情况。新建文件没有前一版，整份文本都是新增。
 *
 * 不再对外：Myers 是 O(N·D)，一个随手可调的导出等于邀请下一个人在渲染路径上
 * 再调一次。结果只经 toToolCallView 出去，那里记着。
 */
function diffStatOf(parts: readonly ToolContentPart[]): DiffStat | null {
  let added = 0
  let removed = 0
  let sawDiff = false

  for (const part of parts) {
    if (part.type !== 'diff') {
      continue
    }

    sawDiff = true

    for (const change of diffLines(part.oldText ?? '', part.newText)) {
      if (change.added === true) {
        added += change.count ?? 0
        continue
      }

      if (change.removed === true) {
        removed += change.count ?? 0
      }
    }
  }

  return sawDiff ? { added, removed } : null
}

/** 一次工具调用画出来需要的全部东西，一趟算完。 */
export interface ToolCallView {
  readonly parts: readonly ToolContentPart[]
  /** 这次调用改了多少行；没带 diff 时是 null。 */
  readonly diffStat: DiffStat | null
}

/*
 * 按来源对象的引用记一次。
 *
 * 键是 reducer 冻结过的那个对象：任何变更都造新对象，所以「同一个引用 ⇒ 同一
 * 份结果」是构造保证的，不是约定。权限请求随身带来的那次调用同理 —— 它从事件里
 * 读出来之后就不再改。上游 timeline-selectors.ts 的行投影用的是同一张形状的表，
 * 这里不引入第二种记忆化范式。
 *
 * 不用 useMemo。转录区是虚拟化的，卡片滚出视口就卸载，useMemo 的缓存跟着一起
 * 走 —— 偏偏在长会话里最需要它的时候失效。WeakMap 的生命周期跟着数据而不是跟
 * 着组件实例，而且旧 item 被回收时缓存自动消失，不需要任何淘汰策略。
 *
 * 值得记的原因是它不便宜：diffStatOf 里是 Myers 差分，而调用它的
 * ToolCallCard 函数体每一帧都要跑一遍 —— 流式期间每个 chunk 都会让整个 feed
 * 重渲，视口里每一张带 diff 的卡片都在里面，包括早就结束的、包括折叠着的
 * （徽章画在 button 上，不在 DisclosureBody 里）。
 */
/*
 * 带着一次调用内容的东西：时间线上那条工具调用，或者权限请求随身带来的那一次。
 *
 * 两边画的是同一份内容 —— 同样的 part、同样的行数增删 —— 所以它们走同一条管线，
 * 而不是各自解析一遍。这里只要 content 这一点形状，谁带着它不重要。
 */
export interface ToolCallContentSource {
  readonly content?: readonly AcpToolCallContent[] | null | undefined
}

/** 没有调用就没有内容。常量，免得每次问都造一个新对象。 */
const EMPTY_VIEW: ToolCallView = { diffStat: null, parts: [] }

const VIEWS = new WeakMap<ToolCallContentSource, ToolCallView>()

export function toToolCallView(source: ToolCallContentSource | null | undefined): ToolCallView {
  if (source === null || source === undefined) {
    return EMPTY_VIEW
  }

  const held = VIEWS.get(source)

  if (held !== undefined) {
    return held
  }

  const parts = toToolContentParts(source.content)
  const view: ToolCallView = { diffStat: diffStatOf(parts), parts }

  VIEWS.set(source, view)

  return view
}
