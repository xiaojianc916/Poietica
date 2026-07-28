import './question-outcome.css'

import type { PermissionItem } from '@poietica/agent-timeline'

/**
 * 答完之后留在流里的那张卡片。
 *
 * 上面是问题，下面是当时摆出来的那几个选项，选中的那个亮着。只写结果是不够的：
 * 事后回看时，"我当初在什么之间选的"和"我选了什么"一样重要，而选项列表过一会
 * 儿就再也拿不到了。
 *
 * skip 不算选项。它是 ACP 通道为了表达"不回答"而追加的一枚 optionId，属于传输
 * 细节；把它摆进列表，用户会以为自己当初有第五个选择。真跳过了就在底下说一句。
 *
 * 这里只认 optionId 的形状，不碰 domain 层的内部结构：这张卡片的职责是复述一件
 * 已经发生的事，不该因为判据的实现换了写法而跟着坏。
 */

const SKIP = /^q\d+_skip$/

export interface QuestionOutcomeProps {
  readonly item: PermissionItem
}

/** 卡片底下那句话：没答、跳过了，或者什么也不必说。 */
function noteFor(item: PermissionItem, picked: string | undefined): string | null {
  if (item.resolution === undefined) {
    return '等待回答…'
  }

  if (picked === undefined) {
    return '已跳过，未回答'
  }

  return SKIP.test(picked) ? '已跳过，未回答' : null
}

export function QuestionOutcome({ item }: QuestionOutcomeProps) {
  const resolution = item.resolution

  const picked =
    resolution === undefined || resolution.outcome === 'cancelled' ? undefined : resolution.optionId

  const note = noteFor(item, picked)

  const choices = item.options.filter((option) => !SKIP.test(option.optionId))

  return (
    <div
      className="assistant-question-outcome"
      data-answered={picked === undefined ? undefined : 'true'}
    >
      <p className="assistant-question-outcome__prompt">{item.title}</p>

      <ul className="assistant-question-outcome__options">
        {choices.map((option) => (
          <li
            className="assistant-question-outcome__option"
            data-picked={option.optionId === picked ? 'true' : undefined}
            key={option.optionId}
          >
            {option.name}
          </li>
        ))}
      </ul>

      {note === null ? null : <p className="assistant-question-outcome__note">{note}</p>}
    </div>
  )
}
