import './permission-request.css'

import type { PermissionOption, PermissionToolCall } from '@poietica/agent-protocol'
import type { PermissionItem } from '@poietica/agent-timeline'
import { useCallback, useState } from 'react'
import { useAgentDialect } from './domain/agent-dialect'
import { isQuestionRequest } from './domain/ask-user-question'
import { OutcomeCard } from './timeline/OutcomeCard'
import { QuestionOutcome } from './timeline/QuestionOutcome'
import { toDiffStat, toToolContentParts } from './timeline/tool-call-content'

/**
 * A permission request, answered in place.
 *
 * The agent is blocked until one option is chosen, so the question is rendered
 * inside the run it interrupts rather than in a dialog that could be dismissed,
 * lost behind a window, or answered out of context.
 *
 * Nothing is resolved optimistically. The click is sent to the port; the run
 * only moves on when permission_resolved comes back through the event log, so
 * what is on screen always matches what the agent was actually told.
 */

const KIND_LABELS: Record<string, string> = {
  delete: '删除文件',
  edit: '修改文件',
  execute: '执行命令',
  fetch: '访问网络',
  move: '移动文件',
  read: '读取文件',
  search: '搜索',
  switch_mode: '切换模式',
  think: '思考',
}

/*
 * 按钮上的字是显示，不是身份。回给 agent 的永远是 optionId，这里只换文案。
 *
 * 认 name，不认 kind。kind 是分类：它决定按钮长什么样、有多危险，那件事已经
 * 交给 data-kind 和样式表了；而分类会重复 —— 一次计划评审同时送来两个
 * allow_once 和两个 reject_once，按 kind 查表的结果是四个按钮写着同两个词，
 * 用户无从分辨自己在选哪一个。name 是协议里的 human-readable label，agent 保证
 * 它是这枚选项说的话。
 *
 * 表由外面交进来。它认得的那些字符串（Revise、Reject and Exit……）是某一家
 * agent 说的话，不是协议的一部分，所以归它自己的档案，不归这个文件。查不到就
 * 照原文显示：宁可显示英文，也不能显示一个错的中文。
 */
function labelFor(option: PermissionOption, labels: Readonly<Record<string, string>>): string {
  return labels[option.name] ?? option.name
}

/*
 * 这次调用指认的落点，一处算法。
 *
 * diff 自报的路径最准；没有 diff 时才退回协议声明的落点。问题那一行、主体那一
 * 段、以及答复之后的那张结果卡问的是同一个问题，所以它不该被抄三遍 —— 抄三遍的
 * 代价不是长，是三份会各自漂移。
 */
function placesOf(toolCall: PermissionToolCall | undefined): readonly string[] {
  const parts = toToolContentParts(toolCall?.content)
  const changed = parts.flatMap((part) => (part.type === 'diff' ? [part.path] : []))

  return changed.length > 0 ? changed : (toolCall?.locations ?? []).map((location) => location.path)
}

/**
 * 到底在批准什么。
 *
 * 一句 Write 不是一个可以回答的问题。协议连同请求一起送来了这次调用本身，所以
 * 这里展示的是它自己声明的东西：动作、落点、以及改动的规模 —— 而不是从参数里
 * 猜出来的复述。路径跟在问题后面，做成一枚等宽胶囊：它是被指认的那个对象，不
 * 是另起一段的附注；长路径在胶囊内换行，不截断。
 */
function PermissionSubject({ toolCall }: { readonly toolCall: PermissionToolCall }) {
  const parts = toToolContentParts(toolCall.content)
  const stat = toDiffStat(parts)
  const places = placesOf(toolCall)

  const said = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')

  return (
    <div className="assistant-permission__subject">
      {places.length > 0 || stat !== null ? (
        <p className="assistant-permission__operation">
          <span>{KIND_LABELS[toolCall.kind ?? 'other'] ?? '操作'}</span>

          {stat === null || stat.added + stat.removed === 0 ? null : (
            <span className="assistant-permission__diffstat">
              {stat.added > 0 ? <span data-sign="added">+{stat.added}</span> : null}
              {stat.removed > 0 ? <span data-sign="removed">-{stat.removed}</span> : null}
            </span>
          )}
        </p>
      ) : null}

      {said.length > 0 ? <pre className="assistant-permission__command">{said}</pre> : null}
    </div>
  )
}

/** 落点跟在问题同一行：被指认的对象不该掉到下一段去。 */
function PermissionAsk({
  title,
  toolCall,
}: {
  readonly title: string
  readonly toolCall: PermissionToolCall | undefined
}) {
  const places = placesOf(toolCall)

  return (
    <p className="assistant-permission__ask">
      <span className="assistant-permission__question">{title}</span>

      {places.map((place) => (
        <code className="assistant-permission__path" key={place}>
          {place}
        </code>
      ))}
    </p>
  )
}

export interface PermissionRequestProps {
  readonly item: PermissionItem
  readonly onResolve: (requestId: string, optionId: string) => void
}

export function PermissionRequest({ item, onResolve }: PermissionRequestProps) {
  const dialect = useAgentDialect()

  const [submittedOptionId, setSubmittedOptionId] = useState<string | undefined>(undefined)

  const resolution = item.resolution

  const handleSelect = useCallback(
    (optionId: string) => {
      setSubmittedOptionId(optionId)
      onResolve(item.requestId, optionId)
    },
    [item.requestId, onResolve],
  )

  /*
   * 提问不是权限请求，尽管它借的是同一条通道。
   *
   * 判据只写在 surface 的路由上是不够的：fixtures、单测、以后别的容器都会直接
   * 渲染这个组件，总有一条路会绕过去，然后 AskUserQuestion 又变回一排"批准 /
   * 拒绝"按钮 —— 而它的选项根本不是那个意思。所以闸设在组件自己身上。
   *
   * 位置在所有 hook 之后：提前到 useState 上面就是条件调用 hook。
   */
  if (isQuestionRequest(item, dialect.questions)) {
    return <QuestionOutcome item={item} />
  }

  /*
   * 答复之后，它就不再是一个请求了。
   *
   * 留在流里的是一条记录，和答完的提问是同一类东西，所以画的是同一张结果卡，而
   * 不是这张请求卡的「已答」变体。此前是后者，代价有两个：同一类记录两种长相，
   * 以及主次颠倒 —— 结局被排成全卡最小最淡的一行，题面反倒成了主行。
   *
   * 前缀也去掉了。结局自己就是一句话，卡片的形状已经说明了下面那行是答案，再写
   * 一遍「已选择：」只是把主行开头四个字让给一句废话。
   */
  if (resolution !== undefined) {
    const cancelled = resolution.outcome === 'cancelled'
    const places = placesOf(item.toolCall)

    return (
      <OutcomeCard
        answer={
          cancelled ? undefined : labelOf(item.options, resolution.optionId, dialect.optionLabels)
        }
        answered={!cancelled}
        note={cancelled ? '请求已取消' : undefined}
        prompt={places.length === 0 ? item.title : `${item.title} ${places.join(' ')}`}
      />
    )
  }

  const isSubmitting = submittedOptionId !== undefined

  return (
    <div aria-busy={isSubmitting} className="assistant-permission">
      <PermissionAsk title={item.title} toolCall={item.toolCall} />

      {item.toolCall === undefined ? null : <PermissionSubject toolCall={item.toolCall} />}

      <div className="assistant-permission__options">
        {item.options.map((option) => (
          <button
            className="assistant-permission__option"
            data-kind={option.kind}
            data-pending={option.optionId === submittedOptionId ? 'true' : undefined}
            disabled={isSubmitting}
            key={option.optionId}
            onClick={() => {
              handleSelect(option.optionId)
            }}
            type="button"
          >
            {labelFor(option, dialect.optionLabels)}
          </button>
        ))}
      </div>
    </div>
  )
}

function labelOf(
  options: readonly PermissionOption[],
  optionId: string,
  labels: Readonly<Record<string, string>>,
): string {
  const option = options.find((candidate) => candidate.optionId === optionId)

  return option === undefined ? optionId : labelFor(option, labels)
}
