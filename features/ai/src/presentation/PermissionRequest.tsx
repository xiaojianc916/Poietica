import './permission-request.css'

import { useCallback, useState } from 'react'

import type { PermissionOption, PermissionToolCall } from '../contracts/run-contract'
import type { PermissionItem } from '../contracts/timeline-contract'
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
 * 按钮上的字是显示，不是身份。
 *
 * agent 送来的 name 是英文（Allow / Allow Always / Reject），但回给它的永远是
 * optionId，所以这里只换文案，按协议自己的 kind 枚举翻译。遇到没见过的 kind
 * 就退回 agent 的原文：宁可显示英文，也不能显示一个空按钮。
 */
const OPTION_LABELS: Record<string, string> = {
  allow_always: '始终批准',
  allow_once: '批准',
  reject_always: '始终拒绝',
  reject_once: '拒绝',
}

function labelFor(option: PermissionOption): string {
  return OPTION_LABELS[option.kind] ?? option.name
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
