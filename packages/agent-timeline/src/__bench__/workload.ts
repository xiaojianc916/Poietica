import type { RunEvent } from '@poietica/acp'

/*
 * 一份合成的对话负载。
 *
 * 所有 TS 侧的测量共用它，所以「跑的是同一段对话」是结构保证，不是约定。
 * 形状取自 recorder.rs 的 RecordedEvent：判别式与载荷平铺，每帧自带 seq 与 at。
 */

/** 一段流式文本的典型长度。取自实际 agent 输出的量级。 */
const CHUNK = 'the quick brown fox jumps over the lazy dog. '

export interface Conversation {
  /** 从零开始的一整条对话，可直接交给 replayThreadEvents。 */
  readonly events: readonly RunEvent[]
  /** 这条对话里有多少条时间轴条目。 */
  readonly items: number
}

function started(seq: number, at: number, prompt: string): RunEvent {
  return { kind: 'run_started', seq, at, prompt } as RunEvent
}

function chunk(seq: number, at: number, text: string): RunEvent {
  return {
    kind: 'acp_update',
    seq,
    at,
    notification: {
      sessionId: 'sess_bench',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    },
  } as RunEvent
}

function toolCall(seq: number, at: number, id: string): RunEvent {
  return {
    kind: 'acp_update',
    seq,
    at,
    notification: {
      sessionId: 'sess_bench',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: 'read file',
        kind: 'read',
        status: 'completed',
        content: [],
        locations: [],
      },
    },
  } as RunEvent
}

function finished(seq: number, at: number): RunEvent {
  return { kind: 'run_finished', seq, at, stopReason: 'end_turn' } as RunEvent
}

/**
 * 一条 `turns` 轮的对话，每轮 `chunks` 段文本加一次工具调用。
 *
 * 每一轮的 seq 从一开始重编 —— 那是原生侧的行为（recorder.rs 的 SeqLine 按会话
 * 编号，而 replayThreadEvents 按段重开窗口），抄错这一条会让整条对话被去重吃掉。
 */
export function conversationOf(turns: number, chunks: number): Conversation {
  const events: RunEvent[] = []
  let at = 1_700_000_000_000

  for (let turn = 0; turn < turns; turn += 1) {
    let seq = 1

    events.push(started(seq, at, `question ${String(turn)}`))

    for (let index = 0; index < chunks; index += 1) {
      seq += 1
      at += 16
      events.push(chunk(seq, at, CHUNK))
    }

    seq += 1
    events.push(toolCall(seq, at, `call-${String(turn)}`))

    seq += 1
    events.push(finished(seq, at))
  }

  /* 一轮产出：提问、一条合并后的文本、一次工具调用。 */
  return { events, items: turns * 3 }
}

/** 一拍到达的那一批帧。屏幕 60Hz，agent 每拍吐十几段是常态。 */
export function tickOf(seq: number, size: number): readonly RunEvent[] {
  const batch: RunEvent[] = []

  for (let index = 0; index < size; index += 1) {
    batch.push(chunk(seq + index, 1_800_000_000_000 + index, CHUNK))
  }

  return batch
}
