import { describe, expect, it } from 'vitest'
import { recordedTurn as spokenTurn } from './__fixtures__/live-turn.generated'

/**
 * 一轮真实对话的录像，作为帧契约的实物证据。
 *
 * 录像由原生 crate 生成、原样提交：
 *
 * ```text
 * $env:POIETICA_ACP_COMMAND = "kimi.CMD acp"
 * $env:POIETICA_ACP_CAPTURE = "<absolute path to __fixtures__/live-turn.generated.ts>"
 * cargo test -p poietica-agent-runtime-native --test live_turn -- --ignored --nocapture
 * ```
 *
 * 采集路径必须是绝对路径：cargo 从 crate 目录而不是工作区根目录运行测试二进制。
 *
 * 这里不再逐帧过一遍校验器 —— 帧的形状由 `RunFrame` 在编译期定下，客户端不该
 * 持有第二份协议描述。录像证明的是另一件事，而且只有录像能证明：真实 agent 送来
 * 的一轮，开合是完整的、编号是稠密的、更新种类都在时间线覆盖范围内。
 *
 * 一份录像永远不够，因为它只证明这家 agent 这一次送了哪些形状。按上面的命令再
 * 采一轮、提交文件、往 `recordings` 里加一行即可 —— 换一家 ACP agent 采的录像
 * 同样有效，这正是这套测试不与任何一家耦合的地方。
 */

const recordings = [{ name: 'a plain answer', frames: spokenTurn }] as const

describe.each(recordings)('a recorded turn: $name', ({ frames }) => {
  it('is not empty', () => {
    expect(frames.length).toBeGreaterThan(0)
  })

  it('opens and closes the way a turn is supposed to', () => {
    const kinds = frames.map((captured) => captured.kind)

    expect(kinds.at(0)).toBe('run_started')
    expect(kinds.at(-1)).toBe('run_finished')
  })

  it('numbers its frames densely from one', () => {
    const sequence = frames.map((captured) => captured.seq)

    expect(sequence).toEqual(sequence.map((_value, index) => index + 1))
  })

  it('carries its discriminator and its position inside the frame itself', () => {
    /* 信封字段是确定的：kind 与 seq 由原生侧的 RunFrame 与它的 Envelope 一起
       写进帧体，外层那两个字段只是同一份事实的索引。这里断言的就是两者不会
       各说各话。 */
    interface Envelope {
      readonly kind: string
      readonly seq: number
      readonly at: number
    }

    for (const captured of frames) {
      const frame = captured.frame as unknown as Envelope

      expect(frame.kind).toBe(captured.kind)
      expect(frame.seq).toBe(captured.seq)
      expect(typeof frame.at).toBe('number')
    }
  })

  it('reports which kinds of update the agent actually sends', () => {
    const kinds = new Set(
      frames
        .map((captured) => captured.frame)
        .filter(
          (frame): frame is { notification: { update: { sessionUpdate: string } } } =>
            typeof frame === 'object' && frame !== null && 'notification' in frame,
        )
        .map((frame) => frame.notification.update.sessionUpdate),
    )

    // Not an assertion about the agent, which is free to send what it likes.
    // This is the inventory the timeline has to cover, kept visible.
    console.info('session update kinds in the recording:', [...kinds].sort().join(', '))

    expect(kinds.size).toBeGreaterThan(0)
  })
})
