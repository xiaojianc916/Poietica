import './assistant.css'

import { Edit, ExternalLink, Link, Trash } from '@mynaui/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'
import { MoreIcon, PinIcon, PlusIcon, ThreadIcon } from './primitives/icons'

/*
 * The thread list.
 *
 * Creating a thread is a property of the list, not of whichever group happens
 * to sort first, so the button lives in the list header and survives an empty
 * list. Grouping is one pass: filtering the whole array once per group was
 * quadratic in the number of threads, which is exactly the axis that grows.
 */

export interface AssistantThreadSummary {
  readonly id: string
  readonly title: string
  readonly relativeTime: string
  readonly group: string
  readonly isMuted?: boolean
}

export interface AssistantThreadListProps {
  readonly threads: readonly AssistantThreadSummary[]
  /** True while the list is still being read for the first time. */
  readonly isLoading?: boolean
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
  onCopyLink,
  onMarkUnread,
  onRename,
  onDelete,
  onOpenInNewTab,
}: AssistantThreadListProps) {
  const groups = group(threads)

  /*
   * 首帧给出行的形状，不给结论。
   *
   * “还没有会话”是一个只有读完才成立的断言，把它当加载态显示，等于每次
   * 开窗都先告诉用户一件错误的事。骨架行是列表类界面的通行做法。
   */
  const showPlaceholders = isLoading === true && groups.length === 0

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

                  {/*
                      Not modal: a modal menu locks pointer events outside
                      itself, so the click that dismissed it was swallowed
                      instead of landing on the row it was aimed at. That
                      was every “clicking does nothing” report.
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
                        DropdownMenuContent is rendered through a Portal. Reapply
                        the AI skin at this DOM boundary so --cp-* tokens remain
                        available after the popup leaves the sidebar subtree.
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
                        onClick={() => onCopyLink?.(thread.id)}
                      >
                        <Link aria-hidden="true" />
                        <span>拷贝链接</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        className="assistant-thread-menu__item"
                        onClick={() => onPin(thread.id)}
                      >
                        <PinIcon aria-hidden="true" />
                        <span>固定</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        className="assistant-thread-menu__item"
                        onClick={() => onMarkUnread?.(thread.id)}
                      >
                        <ThreadIcon aria-hidden="true" />
                        <span>标记为未读</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        className="assistant-thread-menu__item"
                        onClick={() => onRename?.(thread.id)}
                      >
                        <Edit aria-hidden="true" />
                        <span>重命名</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        className="assistant-thread-menu__item assistant-thread-menu__item--destructive"
                        onClick={() => onDelete?.(thread.id)}
                      >
                        <Trash aria-hidden="true" />
                        <span>删除</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator className="assistant-thread-menu__separator" />

                      <DropdownMenuItem
                        className="assistant-thread-menu__item"
                        onClick={() => onOpenInNewTab?.(thread.id)}
                      >
                        <ExternalLink aria-hidden="true" />
                        <span>在新选项卡中打开</span>
                      </DropdownMenuItem>
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
