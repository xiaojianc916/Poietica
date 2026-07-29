import './outcome-card.css'

/**
 * 一件落定的事，和它的结局。
 *
 * 三个槽，没有第四个：题面说当时问的是什么，结局说最后怎么了，附注留给「没答」
 * 「已取消」这类既不是题也不是答的话。层级全部由字号与墨色承担，卡片本身不带
 * 强调色。
 *
 * 它不认识提问，也不认识权限请求 —— 谁是题、谁是答由调用方回答，这里只负责让
 * 两者在流里长成同一个样子。
 */

export interface OutcomeCardProps {
  readonly prompt: string
  readonly answer?: string | undefined
  readonly note?: string | undefined
  readonly answered?: boolean | undefined
}

export function OutcomeCard({ answer, answered, note, prompt }: OutcomeCardProps) {
  return (
    <div className="assistant-outcome" data-answered={answered === true ? 'true' : undefined}>
      <p className="assistant-outcome__prompt">{prompt}</p>

      {answer === undefined ? null : <p className="assistant-outcome__answer">{answer}</p>}

      {note === undefined ? null : <p className="assistant-outcome__note">{note}</p>}
    </div>
  )
}
