import './permission-request.css'

import type { PermissionOption, PermissionToolCall } from '@poietica/agent-protocol'
import type { PermissionItem } from '@poietica/agent-timeline'
import { useCallback, useState } from 'react'
import { isQuestionRequest } from './domain/ask-user-question'
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
 * 按钮上的字是显示，不是身份。回给 agent 的永远是 optionId，所以这里只换文案。
 *
 * 认 name，不认 kind。kind 是分类：它决定按钮长什么样、有多危险，那件事已经由
 * data-kind 交给样式表了；而分类会重复 —— 一次计划评审同时送来两个 allow_once
 * 和两个 reject_once，按 kind 查表的结果是四个按钮写着同两个词，用户无从分辨
 * 自己在选哪一个。name 是协议里的 human-readable label，agent 保证它是这枚选项
 * 说的话。
 *
 * 表里只放规范英文标签的译法，查不到就原样显示 agent 的原文：宁可显示英文，
 * 也不能显示一个错的中文。
 *
 * 这张表认得的字符串是某个 agent 说的话，不是协议的一部分 —— 它的归宿是 agent
 * 档案里的一个声明字段，由装配点作为 prop 传进来。搬家是纯位移，取值语义得先对。
 */
const OPTION_LABELS: Record<string, string> = {
  Allow: '批准',
  'Allow Always': '始终批准',
  Approve: '批准',
  'Approve for this session': '本次会话内始终批准',
  'Approve once': '批准',
  Reject: '拒绝',
  'Reject and Exit': '拒绝并退出',
  Revise: '修改方案',
  Skip: '跳过',
}

function labelFor(option: PermissionOption): string {
  return OPTION_LABELS[option.name] ?? option.name
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

  /* diff 自报的路径最准；没有 diff 时才退回协议声明的落点。 */
  const changed = parts.flatMap((part) => (part.type === 'diff' ? [part.path] : []))
  const places =
    changed.length > 0 ? changed : (toolCall.locations ?? []).map((location) => location.path)

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
  const parts = toToolContentParts(toolCall?.content)
  const changed = parts.flatMap((part) => (part.type === 'diff' ? [part.path] : []))
  const places =
    changed.length > 0 ? changed : (toolCall?.locations ?? []).map((location) => location.path)

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
  if (isQuestionRequest(item)) {
    return <QuestionOutcome item={item} />
  }

  if (resolution !== undefined) {
    return (
      <div className="assistant-permission" data-resolved="true">
        <PermissionAsk title={item.title} toolCall={item.toolCall} />

        {item.toolCall === undefined ? null : <PermissionSubject toolCall={item.toolCall} />}

        <p className="assistant-permission__outcome">
          {resolution.outcome === 'cancelled'
            ? '请求已取消'
            : `已选择：${labelOf(item.options, resolution.optionId)}`}
        </p>
      </div>
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
            {labelFor(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

function labelOf(options: readonly PermissionOption[], optionId: string): string {
  const option = options.find((candidate) => candidate.optionId === optionId)

  return option === undefined ? optionId : labelFor(option)
}
