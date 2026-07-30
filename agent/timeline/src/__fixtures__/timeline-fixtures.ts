import type { RunEvent } from '@poietica/agent-protocol'

/**
 * A hand-written run: thought, text, a tool call that succeeds, a plan, and a
 * clean finish. The presentation layer is developed against this, so the whole
 * surface can be built and reviewed before any agent process exists.
 *
 * It is an illustration, never evidence. This sample once carried tool output as
 * a bare content block, which is not what the protocol says and not what any
 * agent sends, and every test that read it agreed with the mistake. Frames that
 * must be believed live in __fixtures__ and come from a real agent.
 */
export const SAMPLE_RUN_EVENTS: readonly RunEvent[] = [
  /* prompt 留空是有意的：这份样本让紧随其后的 user_message_chunk 承载问题，
     而 withPrompt 对空 prompt 不落条目 —— 两个来源里只有一个说话，转录才不会
     把同一句问两遍。 */
  { kind: 'run_started', seq: 0, at: 1_000, sessionId: 'sess_demo', prompt: '' },
  {
    kind: 'acp_update',
    seq: 1,
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
    seq: 2,
    at: 1_020,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '先读取 README，' },
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 3,
    at: 1_030,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '再与 package.json 对照。' },
      },
    },
  },
  {
    kind: 'acp_update',
    seq: 4,
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
    seq: 5,
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
    seq: 6,
    at: 1_060,
    notification: {
      sessionId: 'sess_demo',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'in_progress' },
    },
  },
  {
    kind: 'acp_update',
    seq: 7,
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
    seq: 8,
    at: 1_100,
    notification: {
      sessionId: 'sess_demo',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '构建命令与 scripts 一致。' },
      },
    },
  },
  { kind: 'run_finished', seq: 9, at: 1_110, stopReason: 'end_turn' },
]
