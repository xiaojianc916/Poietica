import './assistant.css'

import { Edit, ExternalLink, Trash } from '@mynaui/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'
import { useState } from 'react'

import { MoreIcon, PinIcon, PlusIcon, ThreadIcon } from './primitives/icons'

/*
 * 会话列表。
 *
 * 一行的尾部只有一个格子：时间与操作图标叠在同一个网格单元上，由同一个
 * 判定互斥显示，因此不可能同时画出来；格子的宽度取两者的较大值，切换时
 * 标题不会被推动。重命名是行内编辑，输入框占住标题原来的位置，行高不变。
 */

export interface AssistantThreadSummary {
  readonly id: string
  readonly title: string
  readonly relativeTime: string
  readonly group: string
  readonly isMuted?: boolean
  readonly isPinned?: boolean
}

export interface AssistantThreadListProps {
  readonly threads: readonly AssistantThreadSummary[]
  /** True while the list is still being read for the first time. */
  readonly isLoading?: boolean
  readonly activeThreadId: string | null
  readonly onActivate: (threadId: string) => void
  readonly onCreate: () => void
  readonly onPin: (threadId: string, pinned: boolean) => void
  readonly onRename?: (threadId: string, title: string) => void
  readonly onDelete?: (threadId: string) => void
  readonly onOpenInNewTab?: (threadId: string) => void
}

/** Widths that make the skeleton read as a list rather than as a bar. */
const PLACEHOLDER_WIDTHS = ['72%', '54%', '64%', '46%']

function group(threads: readonly AssistantThreadSummary[]) {
  const grouped = new Map<string, AssistantThreadSummary[]>()

  for (const thread of threads) {
    const held = grouped.get(thread.group)

    if (held === undefined) {
      grouped.set(thread.group, [thread])
    } else {
      held.push(thread)
    }
  }

  return [...grouped]
}

export function AssistantThreadList({
  threads,
  isLoading,
  activeThreadId,
  onActivate,
  onCreate,
  onPin,
  onRename,
  onDelete,
  onOpenInNewTab,
}: AssistantThreadListProps) {
  const groups = group(threads)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  /*
   * 首帧给出行的形状，不给结论。
   *
   * “还没有会话”是一个只有读完才成立的断言，把它当加载态显示，等于每次
   * 开窗都先告诉用户一件错误的事。骨架行是列表类界面的通行做法。
   */
  const showPlaceholders = isLoading === true && groups.length === 0

  function beginRename(thread: AssistantThreadSummary) {
    setRenamingId(thread.id)
    setDraft(thread.title)
  }

  /* 提交只走这一条路：Enter、失焦都到这里，空标题等于放弃。 */
  function commitRename() {
    const target = renamingId

    if (target === null) {
      return
    }

    const next = draft.trim()

    setRenamingId(null)
    setDraft('')

    if (next.length > 0) {
      onRename?.(target, next)
    }
  }

  return (
    <nav aria-label="AI 会话记录" className="assistant-threads" data-assistant-skin>
      <header className="assistant-threads__header">
        <span className="assistant-threads__caption">会话</span>

        <button
          aria-label="新建会话"
          className="assistant-threads__create"
          onClick={onCreate}
          type="button"
        >
          <PlusIcon aria-hidden="true" />
        </button>
      </header>

      {showPlaceholders ? (
        <ul aria-hidden="true" className="assistant-threads__list">
          {PLACEHOLDER_WIDTHS.map((width) => (
            <li className="assistant-thread" data-placeholder="true" key={width}>
              <span className="assistant-thread__ghost" style={{ width }} />
            </li>
          ))}
        </ul>
      ) : null}

      {!showPlaceholders && groups.length === 0 ? (
        <p className="assistant-threads__empty">还没有会话。</p>
      ) : null}

      {groups.map(([name, members]) => (
        <section className="assistant-threads__group" key={name}>
          <span className="assistant-threads__caption">{name}</span>

          <ul className="assistant-threads__list">
            {members.map((thread) => (
              <li
                className="assistant-thread"
                data-active={thread.id === activeThreadId ? 'true' : undefined}
                data-muted={thread.isMuted === true ? 'true' : undefined}
                data-renaming={thread.id === renamingId ? 'true' : undefined}
                key={thread.id}
              >
                {thread.id === renamingId ? (
                  <form
                    className="assistant-thread__rename"
                    onSubmit={(event) => {
                      event.preventDefault()
                      commitRename()
                    }}
                  >
                    <ThreadIcon aria-hidden="true" className="assistant-thread__icon" />

                    <input
                      aria-label="重命名会话"
                      className="assistant-thread__rename-field"
                      onBlur={commitRename}
                      onChange={(event) => {
                        setDraft(event.target.value)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setRenamingId(null)
                          setDraft('')
                        }
                      }}
                      ref={(node) => {
                        node?.select()
                      }}
                      value={draft}
                    />
                  </form>
                ) : (
                  <>
                    <button
                      className="assistant-thread__open"
                      onClick={() => {
                        onActivate(thread.id)
                      }}
                      type="button"
                    >
                      <ThreadIcon aria-hidden="true" className="assistant-thread__icon" />
                      <span className="assistant-thread__title">{thread.title}</span>
                    </button>

                    {/*
                        时间与操作共用这一个格子：两者叠放在同一个网格单元里，
                        由同一个判定决定谁可见，因此不会互相盖住。
                      */}
                    <span className="assistant-thread__trail">
                      <span className="assistant-thread__time">{thread.relativeTime}</span>

                      <span className="assistant-thread__actions">
                        <button
                          className="assistant-thread__action"
                          onClick={() => {
                            onPin(thread.id, thread.isPinned !== true)
                          }}
                          title={thread.isPinned === true ? '取消固定' : '固定'}
                          type="button"
                        >
                          <PinIcon aria-hidden="true" />
                        </button>

                        {/*
                            Not modal: a modal menu locks pointer events outside
                            itself, so the click that dismissed it was swallowed
                            instead of landing on the row it was aimed at.
                          */}
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger
                            aria-label="更多操作"
                            className="assistant-thread__action"
                            title="更多操作"
                          >
                            <MoreIcon aria-hidden="true" />
                          </DropdownMenuTrigger>

                          {/*
                              DropdownMenuContent is rendered through a Portal.
                              Reapply the AI skin at this DOM boundary so the
                              --cp-* tokens survive leaving the sidebar subtree.
                            */}
                          <DropdownMenuContent
                            align="end"
                            className="assistant-thread-menu assistant-menu-surface"
                            data-assistant-skin
                            side="bottom"
                            sideOffset={4}
                          >
                            <DropdownMenuItem
                              className="assistant-thread-menu__item"
                              onClick={() => {
                                onPin(thread.id, thread.isPinned !== true)
                              }}
                            >
                              <PinIcon aria-hidden="true" />
                              <span>{thread.isPinned === true ? '取消固定' : '固定'}</span>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              className="assistant-thread-menu__item"
                              onClick={() => {
                                beginRename(thread)
                              }}
                            >
                              <Edit aria-hidden="true" />
                              <span>重命名</span>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              className="assistant-thread-menu__item
                                assistant-thread-menu__item--destructive"
                              onClick={() => {
                                onDelete?.(thread.id)
                              }}
                            >
                              <Trash aria-hidden="true" />
                              <span>删除</span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="assistant-thread-menu__separator" />

                            <DropdownMenuItem
                              className="assistant-thread-menu__item"
                              onClick={() => {
                                onOpenInNewTab?.(thread.id)
                              }}
                            >
                              <ExternalLink aria-hidden="true" />
                              <span>在新选项卡中打开</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
