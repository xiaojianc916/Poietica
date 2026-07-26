import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRunEvent } from './acp-event-schema'

/**
 * The renderer's validator, against frames a real agent actually sent.
 *
 * Every other test of this schema feeds it frames written to satisfy it, which
 * proves only that the schema agrees with its author. The fixture here is a
 * recording of one real turn, produced by the native crate and committed
 * unedited:
 *
 * ```text
 * $env:POIETICA_ACP_CAPTURE = "features/ai/src/domain/__fixtures__/live-turn.json"
 * cargo test -p poietica-ai-acp-native --test live_turn -- --ignored --nocapture
 * ```
 *
 * A frame this validator rejects is a frame the timeline never sees, so a
 * rejection here is a feature that silently does not work, not a test detail.
 */

interface CapturedFrame {
  readonly seq: number
  readonly kind: string
  readonly frame: unknown
}

const fixture = fileURLToPath(new URL('./__fixtures__/live-turn.json', import.meta.url))
const recorded = existsSync(fixture)

// Skipped rather than faked: a recording that nobody recorded would prove
// nothing, and inventing one would quietly turn this into another test of the
// schema against itself.
describe.skipIf(!recorded)('a recorded turn', () => {
  const frames = (): readonly CapturedFrame[] =>
    JSON.parse(readFileSync(fixture, 'utf8')) as readonly CapturedFrame[]

  it('is not empty', () => {
    expect(frames().length).toBeGreaterThan(0)
  })

  it('is accepted frame by frame', () => {
    const rejected = frames()
      .map((captured) => ({ captured, parsed: parseRunEvent(captured.frame) }))
      .filter((entry) => !entry.parsed.ok)
      .map((entry) =>
        [
          `seq ${entry.captured.seq} (${entry.captured.kind})`,
          entry.parsed.ok ? '' : entry.parsed.issue,
          JSON.stringify(entry.captured.frame),
        ].join('\n  '),
      )

    expect(rejected).toEqual([])
  })

  it('opens and closes the way a turn is supposed to', () => {
    const kinds = frames().map((captured) => captured.kind)

    expect(kinds.at(0)).toBe('run_started')
    expect(kinds.at(-1)).toBe('run_finished')
  })

  it('numbers its frames densely from one', () => {
    const sequence = frames().map((captured) => captured.seq)

    expect(sequence).toEqual(sequence.map((_value, index) => index + 1))
  })

  it('reports which kinds of update the agent actually sends', () => {
    const kinds = new Set(
      frames()
        .map((captured) => captured.frame)
        .filter(
          (frame): frame is { notification: { update: { sessionUpdate: string } } } =>
            typeof frame === 'object' &&
            frame !== null &&
            'notification' in frame &&
            typeof (frame as { notification: unknown }).notification === 'object',
        )
        .map((frame) => frame.notification.update.sessionUpdate),
    )

    // Not an assertion about the agent, which is free to send what it likes.
    // This is the inventory the timeline has to cover, kept visible.
    console.info('session update kinds in the recording:', [...kinds].sort().join(', '))

    expect(kinds.size).toBeGreaterThan(0)
  })
})
