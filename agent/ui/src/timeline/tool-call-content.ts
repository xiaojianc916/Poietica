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
  content: readonly AcpToolCallContent[] | undefined,
): readonly ToolContentPart[] {
  if (content === undefined) {
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
 */
export function toDiffStat(parts: readonly ToolContentPart[]): DiffStat | null {
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
