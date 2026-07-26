import type { AcpToolCallContent } from '../../contracts/acp-session-contract'

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
