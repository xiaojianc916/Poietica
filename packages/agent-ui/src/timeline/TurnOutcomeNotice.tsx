import type { TurnOutcome } from '@poietica/agent-timeline'

const WORDING: Record<TurnOutcome['status'], string> = {
  completed: '助手结束了这一轮，但没有返回任何内容。',
  cancelled: '这一轮已被取消。',
  failed: '助手以失败或拒绝结束了这一轮，没有返回任何内容。',
}

/**
 * The end of a turn that said nothing.
 *
 * The status is shown verbatim next to the sentence. It is the one piece of
 * evidence that separates an agent which answered nothing from a client that
 * lost the answer, and it costs one word to show.
 */
export function TurnOutcomeNotice({ outcome }: { readonly outcome: TurnOutcome }) {
  return (
    <p className="timeline-notice" role="status">
      {WORDING[outcome.status]}

      <span className="timeline-notice__status">{`（${outcome.status}）`}</span>
    </p>
  )
}
