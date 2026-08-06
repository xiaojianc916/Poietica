import type { PermissionItem } from '@poietica/agent-timeline'
import { memo } from 'react'
import { useAgentDialect } from '../semantics/agent-dialect'
import { parseQuestionOptionId, readQuestionPrompt } from '../semantics/ask-user-question'
import { OutcomeCard } from './outcome-card'

/**
 * 答完之后留在流里的那张卡片。
 *
 * 上面是问题，下面是那一个答案，落选的选项不再露面：回看一条消息流要读的是
 * 决定，不是当时的备选清单；把没被选的东西也摆出来，等于每次回看都把选择过程
 * 重演一遍。层级由字号和墨色给 —— 题面小而淡，答案大半档、重一点。
 *
 * 题面取自 readQuestionPrompt，不是 item.title：title 在 wire 上被 adapter 写死
 * 成 'AskUserQuestion'，真正的问题在 toolCall.content 里。一张写着工具名的卡片
 * 复述不了任何事。
 *
 * skip 不算选项。它是 ACP 通道为了表达"不回答"而追加的一枚 optionId，属于传输
 * 细节；把它摆进列表，用户会以为自己当初有第五个选择。真跳过了就在底下说一句。
 *
 * 卡片本身归 OutcomeCard 所有：一道答完的提问和一次答复过的权限请求在流里是同
 * 一类记录，它们的形状因此只有一处定义。这里只回答「哪一句是题、哪一句是答」。
 */

export interface QuestionOutcomeProps {
  readonly item: PermissionItem
}

/** 卡片底下那句话：没答、跳过了，或者什么也不必说。 */
function noteFor(
  item: PermissionItem,
  picked: string | undefined,
  skipped: boolean,
): string | null {
  if (item.resolution === undefined) {
    return '等待回答…'
  }

  if (picked === undefined) {
    return '已跳过，未回答'
  }

  return skipped ? '已跳过，未回答' : null
}

/*
 * memo 与 TimelineRow 同一策略：行的身份由 selector 保持，滚动与流式输出
 * 不该让一张内容没变的记录卡每帧重渲。
 */
export const QuestionOutcome = memo(function QuestionOutcome({ item }: QuestionOutcomeProps) {
  const dialect = useAgentDialect()

  const resolution = item.resolution

  const picked =
    resolution === undefined || resolution.outcome === 'cancelled' ? undefined : resolution.optionId

  /* 哪一枚 optionId 表示「跳过」，由方言说了算，不由这里自带一条正则。 */
  const skipped =
    picked !== undefined && parseQuestionOptionId(picked, dialect.questions)?.kind === 'skip'

  const note = noteFor(item, picked, skipped)

  /* 只取被选中的那一个；取不到就什么也不画，底下那句话负责交代。 */
  const answer =
    picked === undefined || skipped
      ? undefined
      : item.options.find((option) => option.optionId === picked)?.name

  return (
    <OutcomeCard
      answer={answer}
      answered={picked !== undefined}
      note={note ?? undefined}
      prompt={readQuestionPrompt(item)}
    />
  )
})
