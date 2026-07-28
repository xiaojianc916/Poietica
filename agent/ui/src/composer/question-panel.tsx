import { useMemo, useState } from 'react'

import type { QuestionAnswer, QuestionDeck } from '../domain/ask-user-question'

/*
 * 输入框长出来的问答面板。
 *
 * 它不是浮层，也不是时间线里的卡片：composer 在有待答题组时整个换成它，答完再
 * 换回去。所以这里刻意不画外壳边框——外壳仍是 composer 自己那一层。
 *
 * 三层结构是为了那个「长」字：外层是单行 grid，行高从 0fr 撑到 1fr，中层裁掉
 * 溢出，内层才是内容。高度因此是被撑开的，不是先占好位再淡入——后者看起来是
 * 「浮现」，不是「长出来」。翻页时内层换 key，只淡入内容，外壳纹丝不动。
 *
 * 推进语义：点选项只落一个选中态，翻页要点"下一题"；箭头可回退改答；最后一题
 * 的按钮是"发送"，这时才把整组答案一次交出去。中途不回任何东西，因为 ACP 的
 * request_permission 一旦答了就收不回来，而用户要能改。
 *
 * 不 import 设计系统与 primitives：这一层要能在目录重排后原样存活，图标与 cx
 * 都就地解决，省得为三行工具函数绑一条相对路径。
 */

function cx(...parts) {
  return parts.filter((part) => typeof part === 'string' && part.length > 0).join(' ')
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

/*
 * 选项左侧那枚记号。
 *
 * 未选是空心圈，选中是实心加一个勾——选中与否首先由这枚图标说，颜色只是跟着
 * 它走。勾的描边取外壳底色而不是白色，深色皮肤下才不会糊成一团。
 */
function MarkIcon({ selected }: { readonly selected: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <circle
        cx="8"
        cy="8"
        fill={selected ? 'currentColor' : 'none'}
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />

      {selected ? (
        <path
          d="M5.4 8.3 7.1 10 10.6 6.4"
          stroke="var(--assistant-surface, #fff)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      ) : null}
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
      <div className="assistant-question-panel__inner">
        <div className="assistant-question-panel__page" key={index}>
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
                  className="assistant-question-panel__option"
                  data-selected={chosen === choice.optionId ? 'true' : undefined}
                  disabled={busy}
                  onClick={() => {
                    setPicked((current) => ({ ...current, [card.requestId]: choice.optionId }))
                  }}
                  type="button"
                >
                  <span className="assistant-question-panel__mark">
                    <MarkIcon selected={chosen === choice.optionId} />
                  </span>

                  <span className="assistant-question-panel__label">{choice.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <footer className="assistant-question-panel__foot">
            <span className="assistant-question-panel__hint">
              {chosen === undefined ? '未选择时按跳过处理' : ''}
            </span>

            <button
              className={cx('assistant-question-panel__advance', chosen === undefined && 'is-idle')}
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
        </div>
      </div>
    </section>
  )
}
