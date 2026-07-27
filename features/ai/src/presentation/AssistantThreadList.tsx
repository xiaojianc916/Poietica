import './assistant-composer.css'

import { Edit, ExternalLink, Link, Trash } from '@mynaui/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'
import { MoreIcon, PinIcon, PlusIcon, ThreadIcon } from './primitives/icons'

export interface AssistantThreadSummary {
  readonly id: string
  readonly title: string
  readonly relativeTime: string
  readonly group: string
  readonly isMuted?: boolean
}

export interface AssistantThreadListProps {
  readonly threads: readonly AssistantThreadSummary[]
  readonly activeThreadId: string | null
  readonly onActivate: (threadId: string) => void
  readonly onCreate: () => void
  readonly onPin: (threadId: string) => void
  readonly onCopyLink?: (threadId: string) => void
  readonly onMarkUnread?: (threadId: string) => void
  readonly onRename?: (threadId: string) => void
  readonly onDelete?: (threadId: string) => void
  readonly onOpenInNewTab?: (threadId: string) => void
}

export function AssistantThreadList({
  threads,
  activeThreadId,
  onActivate,
  onCreate,
  onPin,
  onCopyLink,
  onMarkUnread,
  onRename,
  onDelete,
  onOpenInNewTab,
}: AssistantThreadListProps) {
  const groups = [...new Set(threads.map((thread) => thread.group))]

  return (
    <nav aria-label="AI 会话记录" className="assistant-threads" data-assistant-skin>
      {groups.map((group) => (
        <section className="assistant-threads__group" key={group}>
          <header className="assistant-threads__header">
            <span className="assistant-threads__caption">{group}</span>

            {group === groups[0] ? (
              <button
                aria-label="新建会话"
                className="assistant-threads__create"
                onClick={onCreate}
                type="button"
              >
                <PlusIcon aria-hidden="true" />
              </button>
            ) : null}
          </header>

          <ul className="assistant-threads__list">
            {threads
              .filter((thread) => thread.group === group)
              .map((thread) => (
                <li
                  className="assistant-thread"
                  data-active={thread.id === activeThreadId ? 'true' : 'false'}
                  data-muted={thread.isMuted ? 'true' : 'false'}
                  key={thread.id}
                >
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

                  <span className="assistant-thread__time">{thread.relativeTime}</span>

                  <span className="assistant-thread__actions">
                    <button
                      className="assistant-thread__action"
                      onClick={() => {
                        onPin(thread.id)
                      }}
                      title="固定"
                      type="button"
                    >
                      <PinIcon aria-hidden="true" />
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="更多操作"
                        className="assistant-thread__action"
                        title="更多操作"
                      >
                        <MoreIcon aria-hidden="true" />
                      </DropdownMenuTrigger>

                      {/*
                        DropdownMenuContent is rendered through a Portal. Reapply
                        the AI skin at this DOM boundary so --cp-* tokens remain
                        available after the popup leaves the sidebar subtree.
                      */}
                      <DropdownMenuContent
                        align="end"
                        className="assistant-thread-menu"
                        data-assistant-skin
                        side="bottom"
                        sideOffset={4}
                      >
                        <DropdownMenuItem
                          className="assistant-thread-menu__item"
                          onClick={() => {
                            onCopyLink?.(thread.id)
                          }}
                        >
                          <Link aria-hidden="true" />
                          <span>拷贝链接</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="assistant-thread-menu__item"
                          onClick={() => {
                            onPin(thread.id)
                          }}
                        >
                          <PinIcon aria-hidden="true" />
                          <span>固定</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="assistant-thread-menu__item"
                          onClick={() => {
                            onMarkUnread?.(thread.id)
                          }}
                        >
                          <ThreadIcon aria-hidden="true" />
                          <span>标记为未读</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="assistant-thread-menu__item"
                          onClick={() => {
                            onRename?.(thread.id)
                          }}
                        >
                          <Edit aria-hidden="true" />
                          <span>重命名</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="assistant-thread-menu__item assistant-thread-menu__item--destructive"
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

                        <p className="assistant-thread-menu__meta">
                          上次更新时间为 {thread.relativeTime}前
                        </p>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
