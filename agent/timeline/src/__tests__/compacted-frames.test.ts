import type { RunEvent } from '@poietica/agent-protocol'
import { describe, expect, it } from 'vitest'
import { SAMPLE_RUN_EVENTS } from '../__fixtures__/timeline-fixtures'
import { replayRunEvents } from '../timeline-reducer'

/**
 * The same run, with its two adjacent thought fragments already joined.
 *
 * Written out by hand on purpose. Deriving it from the sample would mean
 * shipping a second implementation of the fold, and then this file would be
 * testing that the two agreed rather than that the reducer cannot tell the
 * difference — which is the only thing worth asserting here.
 */
const COMPACTED_RUN_EVENTS: readonly RunEvent[] = [
  { kind: 'run_started', seq: 1, at: 1_000, sessionId: 'sess_demo' },
  {
    kind: 'acp_update',
    seq: 2,
    at: 1_010,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: '把 README 里的构建命令核对一遍' },
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 3,
    at: 1_020,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '先读取 README，再与 package.json 对照。' },
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 5,
    at: 1_040,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: '读取 README', status: 'in_progress', priority: 'high' },
          { content: '对照 package.json scripts', status: 'pending', priority: 'medium' },
        ],
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 6,
    at: 1_050,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_1',
        title: 'Read README.md',
        kind: 'read',
        status: 'pending',
        locations: [{ path: 'README.md' }],
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 7,
    at: 1_060,
    notification: {
      sessionId: 'sess_demo',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'in_progress' },
    },
  },
  {
    kind: 'acp_update',
    seq: 8,
    at: 1_090,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: '# Poietica ...' } }],
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 9,
    at: 1_100,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '构建命令与 scripts 一致。' },
      },
    },
  },
  { kind: 'run_finished', seq: 10, at: 1_110, stopReason: 'end_turn' },
]

describe('compacted frames', () => {
  /* This is the property the stored snapshot rests on. If it ever stops
     holding, a conversation reopened would differ from having watched it, and
     the compaction has to go rather than the assertion. */
  it('replays to exactly what the unfolded frames replay to', () => {
    const fromLog = replayRunEvents(SAMPLE_RUN_EVENTS)
    const fromSnapshot = replayRunEvents(COMPACTED_RUN_EVENTS)

    expect(fromSnapshot.items).toEqual(fromLog.items)
    expect(fromSnapshot.status).toBe(fromLog.status)
  })

  it('would not survive joining two different sorts of fragment', () => {
    /* Why the fold stops between a thought and a message: they are two items,
       and merging them would silently make the stored run say something the
       live one never did. */
    const across: readonly RunEvent[] = [
      {
        kind: 'acp_update',
        seq: 1,
        at: 1,
        notification: {
          sessionId: 's',
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '想' } },
        },
      },
      {
        kind: 'acp_update',
        seq: 2,
        at: 2,
        notification: {
          sessionId: 's',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '说' } },
        },
      },
    ]

    expect(replayRunEvents(across).items.map((item) => item.type)).toEqual([
      'agent_thought',
      'agent_text',
    ])
  })
})
