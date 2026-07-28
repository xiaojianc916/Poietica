import { useMemo, useState } from 'react'

import type { QuestionAnswer, QuestionDeck } from '../domain/ask-user-question'

/*
 * 输入框长出来的问答面板。
 *
 * 它不是浮层，也不是时间线里的卡片：composer 在有待答题组时整个换成它，答完再
 * 换回去。所以这里刻意不画外壳边框——外壳仍是 composer 自己那一层。
 *
 * 推进语义：点选项只落一个选中态，翻页要点"下一题"；箭头可回退改答；最后一题
 * 的按钮是"发送"，这时才把整组答案一次交出去。中途不回任何东西，因为 ACP 的
 * request_permission 一旦答了就收不回来，而用户要能改。
 *
 * 不 import 设计系统与 primitives：这一层要能在目录重排后原样存活，图标与 cx
 * 都就地解决，省得为三行工具函数绑一条相对路径。
 */

function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
}

function ChevronLeftIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M10 3.5 5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function DismissIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 16 16" width="12">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

export interface QuestionPanelProps {
  readonly deck: QuestionDeck
  /** 全部答完。逐题一条，顺序与题组一致。 */
  readonly onSubmit: (answers: readonly QuestionAnswer[]) => void
  /** ✕：整组跳过。每题回它自己的 skip；没有 skip 的题不出现在结果里。 */
  readonly onSkipAll: (answers: readonly QuestionAnswer[]) => void
  /** 提交中：按钮转不可点，避免重复回包。 */
  readonly busy?: boolean
}

export function QuestionPanel({ busy = false, deck, onSkipAll, onSubmit }: QuestionPanelProps) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({})

  const total = deck.cards.length
  const card = deck.cards[Math.min(index, total - 1)]

  const skipAnswers = useMemo<readonly QuestionAnswer[]>(
    () =>
      deck.cards.flatMap((entry) =>
        entry.skipOptionId === undefined
          ? []
          : [{ requestId: entry.requestId, optionId: entry.skipOptionId }],
      ),
    [deck],
  )

  if (card === undefined) {
    return null
  }

  const chosen = picked[card.requestId]
  const isLast = index === total - 1

  /* 没选的题按跳过算，"下一题"不会把用户卡死在某一题上。 */
  const collect = (): readonly QuestionAnswer[] =>
    deck.cards.flatMap((entry) => {
      const optionId = picked[entry.requestId] ?? entry.skipOptionId

      return optionId === undefined ? [] : [{ requestId: entry.requestId, optionId }]
    })

  return (
    <section
      aria-label="来自助手的问题"
      className="assistant-question-panel"
      data-slot="question-panel"
    >
      <header className="assistant-question-panel__head">
        {card.header === '' ? null : (
          <span className="assistant-question-panel__tag">{card.header}</span>
        )}

        <p className="assistant-question-panel__prompt">{card.prompt}</p>

        <div className="assistant-question-panel__nav">
          <button
            aria-label="上一题"
            className="assistant-question-panel__arrow"
            disabled={index === 0}
            onClick={() => {
              setIndex((current) => Math.max(0, current - 1))
            }}
            type="button"
          >
            <ChevronLeftIcon />
          </button>

          <span className="assistant-question-panel__count">
            {index + 1}/{total}
          </span>

          <button
            aria-label="下一题"
            className="assistant-question-panel__arrow"
            disabled={isLast}
            onClick={() => {
              setIndex((current) => Math.min(total - 1, current + 1))
            }}
            type="button"
          >
            <ChevronRightIcon />
          </button>

          <button
            aria-label="跳过全部问题"
            className="assistant-question-panel__dismiss"
            disabled={busy}
            onClick={() => {
              onSkipAll(skipAnswers)
            }}
            type="button"
          >
            <DismissIcon />
          </button>
        </div>
      </header>

      <ul className="assistant-question-panel__options">
        {card.choices.map((choice) => (
          <li key={choice.optionId}>
            <button
              aria-pressed={chosen === choice.optionId}
              className={cx(
                'assistant-question-panel__option',
                chosen === choice.optionId && 'is-selected',
              )}
              disabled={busy}
              onClick={() => {
                setPicked((current) => ({ ...current, [card.requestId]: choice.optionId }))
              }}
              type="button"
            >
              {choice.label}
            </button>
          </li>
        ))}
      </ul>

      <footer className="assistant-question-panel__foot">
        <span className="assistant-question-panel__hint">
          {chosen === undefined ? '未选择时按跳过处理' : ''}
        </span>

        <button
          className="assistant-question-panel__advance"
          disabled={busy}
          onClick={() => {
            if (isLast) {
              onSubmit(collect())
              return
            }

            setIndex((current) => Math.min(total - 1, current + 1))
          }}
          type="button"
        >
          {isLast ? '发送' : '下一题'}
        </button>
      </footer>
    </section>
  )
}
