import './permission-dock.css'

import type { AcpPermissionOption } from '@poietica/acp'
import type { PermissionItem } from '@poietica/agent-timeline'
import { memo, useState } from 'react'
import { useAgentDialect } from '../semantics/agent-dialect'
import { readToolIntent } from '../semantics/tool-intent'

/**
 * 要批准的那一件事，就在下一句话的正上方。
 *
 * 它不是转录的一行：一次审批是拦在「继续」前面的一道闸，闸属于操作区，放进流里
 * 它会跟着滚动条走开，人得先找回它才能放行。它也不是浮在输入框上的第二块东西 ——
 * 操作区在这个界面上是一张卡（assistant.css 的 [data-slot="prompt-input"]），
 * 所以这条带子是那张卡顶上的一格，是它的第一个孩子。
 *
 * 兄弟那一版靠三处约定假装贴着：自己画左右上三条边、把下边置零、把上圆角抄成和
 * 卡一样 —— 而卡片自己的上边框照画不误，于是接缝处始终是两个盒子摞着，不是一个
 * 盒子分了两格。同一个坑仓里记过两次（--am-shadow 的双重边、输入框底边的加粗）。
 *
 * 同一条结论也已经写过一次：题组来的时候输入框自己长成面板（见 assistant-composer
 * 那段「后者会在滚动、聚焦和 Esc 上处处露馅」），而不是浮一个面板上去。审批与提问
 * 借的是同一条协议通道，没有理由用两种范式。
 *
 * 一次只画一个。并行的请求彼此独立，一个个答与一叠一起答在协议上没有分别，
 * 而一个个答不需要把这条带子改成队列 —— 序号只报分母（见 pendingPermissionCount）。
 *
 * 答完什么都不留。剩下的是一次操作痕迹，而痕迹归事件日志：原生侧的
 * permission_requested / permission_resolved 一条不少，转录不做第二个事实来源。
 * 见 docs/adr/0003。
 */

/*
 * 按钮上的字是显示，不是身份。回给 agent 的永远是 optionId。
 *
 * 认 name，不认 kind：kind 会重复（kimi 的 approve_once 与 approve_always 同为
 * allow_once），按 kind 查表的结果是两颗按钮写着同一个词。name 是协议里的
 * human-readable label。查不到就照原文显示 —— 宁可显示英文，也不能显示一个
 * 错的中文。
 */
function labelFor(option: AcpPermissionOption, labels: Readonly<Record<string, string>>): string {
  return labels[option.name] ?? option.name
}

/*
 * 被涂色的只有一颗。
 *
 * 此前是「所有 allow_once 都涂」，而 kimi 一次送来两颗 allow_once（批准一次、
 * 本会话都批准）—— 两颗一样重，人看不出默认动作是哪一个。agent 把它想要的那个
 * 排在前面，所以第一颗放行选项就是主按钮。
 */
function leadOf(options: readonly AcpPermissionOption[]): string | undefined {
  return options.find((option) => option.kind.startsWith('allow'))?.optionId
}

export interface PermissionDockProps {
  readonly item: PermissionItem
  /** 本段里还在等的一共几个。1 表示只有这一个，序号因此不出现。 */
  readonly waiting: number
  readonly onResolve: (requestId: string, optionId: string) => void
}

export const PermissionDock = memo(function PermissionDock({
  item,
  onResolve,
  waiting,
}: PermissionDockProps) {
  const dialect = useAgentDialect()

  const [submitted, setSubmitted] = useState<string | undefined>(undefined)

  /*
   * 换了一个请求，就该从「一个都没点」重新开始。
   *
   * 渲染期直接改自己的 state 是 React 官方给「props 变了要复位 state」的写法，
   * 本次渲染内重跑，不多一帧，也不需要 effect。不用 key：key 会把整条带子重新
   * 挂载，于是下一个请求顶上来时撑开动画会再播一遍 —— 连着三个审批闪三下。
   */
  const [asked, setAsked] = useState(item.requestId)

  if (asked !== item.requestId) {
    setAsked(item.requestId)
    setSubmitted(undefined)
  }

  /*
   * 不包 useCallback。
   *
   * 它唯一的读者是下面那个内联箭头（onClick={() => handleSelect(...)}），而那个
   * 箭头每次渲染都是新的 —— 稳定这一层的身份因此没有任何人在读，换来的只是每次
   * 渲染多一次依赖数组的分配与比较。要么两处都稳，要么两处都不稳；三四颗按钮
   * 不值得为它引一层 per-option 的回调缓存。
   */
  const handleSelect = (optionId: string) => {
    setSubmitted(optionId)
    onResolve(item.requestId, optionId)
  }

  /*
   * 要批准的那件事本身。
   *
   * title 只是一个工具名：上游在 ACP 边界上把 command / search / url_fetch 三类
   * displayBlock 一律丢掉（convert.ts 的 displayBlockToAcpContent），送到这里的
   * 就只剩一个 "Bash"。而「要不要允许 Bash」不是一个能回答的问题。
   *
   * 入参是完整的，请求随身带着（PermissionItem.toolCall），所以意图没有真的丢。
   * 重建它的那份判据仓里已经有了，工具卡片正在用 —— 这里读同一个函数，不抄第二份：
   * 两份「这次调用要做什么」漂开的那天，带子和卡片会各说一套。
   */
  const call = item.toolCall
  const intent =
    call === undefined
      ? null
      : readToolIntent({ locations: call.locations ?? [], rawInput: call.rawInput })

  const lead = leadOf(item.options)

  const isSubmitting = submitted !== undefined

  return (
    <div className="assistant-approval">
      {/* key 在里层：换请求时只有内容交叉淡入，外壳不重放撑开。 */}
      <div aria-busy={isSubmitting} className="assistant-approval__bar" key={item.requestId}>
        {waiting > 1 ? <span className="assistant-approval__count">1/{waiting}</span> : null}

        {/*
          题面是 agent 送来的那一句，原样。这里不加前缀、不翻译、不改写：
          写成「需要批准 · 执行终端命令：…」是在用一句我们编的话，去复述一句
          agent 已经说清楚了的话。
        */}
        <span className="assistant-approval__title" title={item.title}>
          {item.title}
        </span>

        {/* 工具名让位，意图占主位：一屏的 Bash、Read、Glob 之间没有区别。 */}
        {intent === null ? null : (
          <span className="assistant-approval__intent" title={intent.full}>
            {intent.text}
          </span>
        )}

        <div className="assistant-approval__options">
          {item.options.map((option) => (
            <button
              className="assistant-approval__option"
              data-lead={option.optionId === lead ? 'true' : undefined}
              data-pending={option.optionId === submitted ? 'true' : undefined}
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
    </div>
  )
})
