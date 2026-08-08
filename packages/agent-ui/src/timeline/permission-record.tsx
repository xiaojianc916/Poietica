import type { PermissionItem } from '@poietica/agent'
import { useAgentDialect } from '../semantics/agent-dialect'
import { isQuestionRequest } from '../semantics/ask-user-question'
import { QuestionOutcome } from './question-outcome'

/**
 * 一条权限请求在转录里留下的东西。
 *
 * 通常什么也不留：待答的那一个由输入框上方的审批带持有，答完的那一个是一次
 * 操作痕迹，而痕迹归事件日志（见 docs/adr/0003）。
 *
 * 唯一的例外是「提问用户」。它在协议上也是一条 permission —— 借的是同一条通道
 * —— 但它不是审批：agent 问的是一个选择，答案是对话的一部分，所以它答完之后
 * 留在流里，和别的记录一样。
 *
 * 判据不能挪进 agent-timeline：认不认得出一道提问，取决于对面那家 agent 的说法
 * （dialect.questions），那是 UI 的知识。所以这一支留在这里，而 renderable 那条
 * 「哪一条上屏」的判据一个字不动。
 */
export function PermissionRecord({ item }: { readonly item: PermissionItem }) {
  const dialect = useAgentDialect()

  return isQuestionRequest(item, dialect.questions) ? <QuestionOutcome item={item} /> : null
}
