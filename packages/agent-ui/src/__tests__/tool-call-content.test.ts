import type { RunEvent } from '@poietica/acp'
import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
import { replayRunEvents } from '@poietica/agent-timeline'
import { recordedToolTurn } from '@poietica/agent-timeline/fixtures'
import { describe, expect, it } from 'vitest'
import { toToolContentParts } from '../timeline/tool-call-content'

/**
 * The tool card, fed by the turn that actually happened.
 *
 * The text case is driven by the recording, because that is the case a hand
 * written sample got wrong once already. The diff and terminal cases below only
 * illustrate our own mapping; they prove nothing about the protocol.
 */

const events: readonly RunEvent[] = recordedToolTurn.map(
  (captured) => captured.frame as unknown as RunEvent,
)

const state = replayRunEvents(events)

const toolItems = state.items.filter(
  (item): item is ToolCallTimelineItem => item.type === 'tool_call',
)

describe('what a recorded tool call has to show', () => {
  it('was recorded for a tool call that produced output', () => {
    expect(toolItems).toHaveLength(1)
    expect(toolItems.at(0)?.content.length).toBeGreaterThan(0)
  })

  it('turns the protocol envelope into text a card can draw', () => {
    const parts = toToolContentParts(toolItems.at(0)?.content)

    expect(parts.length).toBeGreaterThan(0)
    expect(parts.every((part) => part.type === 'text')).toBe(true)
    expect(parts.map((part) => (part.type === 'text' ? part.text : '')).join('')).toContain(
      'Poietica',
    )
  })

  it('drops the empty bubble a tool call opens with', () => {
    const parts = toToolContentParts([{ type: 'content', content: { type: 'text', text: '' } }])

    expect(parts).toEqual([])
  })

  it('keeps a diff whole, and says when there was nothing before it', () => {
    const parts = toToolContentParts([
      { type: 'diff', path: 'notes.md', newText: 'after' },
      { type: 'terminal', terminalId: 'term_1' },
    ])

    expect(parts).toEqual([
      { type: 'diff', path: 'notes.md', oldText: null, newText: 'after' },
      { type: 'terminal', terminalId: 'term_1' },
    ])
  })

  it('names a block it cannot draw instead of inventing one', () => {
    const parts = toToolContentParts([
      { type: 'content', content: { type: 'image', data: 'x', mimeType: 'image/png' } },
    ])

    expect(parts).toEqual([{ type: 'opaque', label: '一张图片' }])
  })
})
