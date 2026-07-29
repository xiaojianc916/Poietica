import './assistant.css'

import { Edit, ExternalLink, Trash } from '@mynaui/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'
import { memo, useCallback, useState } from 'react'

import { MoreIcon, PinFilledIcon, PinIcon, PlusIcon, ThreadIcon } from './primitives/icons'
import { formatAbsolute, formatElapsed, nextChangeIn, sectionsOf, useNow } from './time'

/*
 * 会话列表。
 *
 * 一行是一个组件。此前整行——重命名表单、时间格、固定按钮、四项菜单——都摊在
 * 父组件 map 的匿名回调里，于是列表没有可比较的边界：时钟每跳一次、草稿每多
 * 一个字符，每一行连同它各自持有的菜单根都要重建一遍。列表类界面把行做成
 * 可比较的组件是通行做法，这里补上。
 *
 * 一行的尾部只有一个格子：时间与操作叠在同一个网格单元上，由同一个判定
 * 互斥显示，因此不可能同时画出来；宽度取两者较大者，图标出现时标题不动。
 *
 * 加号是入口，不是记录：它把「新建会话」那一格交给工作台去开或去激活，
 * 不在数据库里先造一条没人说过话的会话。
 */

export interface AssistantThreadSummary {
  readonly id: string
  readonly title: string
  /**
   * 最后一次活动的时刻，ISO-8601。
   *
   * 传时刻而不是传算好的文案：文案随墙上时间变化，只有持有时钟的这一层
   * 才有资格算它。分段同理，它是文案的另一种切法，不是上游的数据。
   */
  readonly updatedAt: string
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

/*
 * 固定与取消固定是同一枚图钉的两种填法。
 *
 * 图标库有 pin 的 solid 变体，于是「已固定」画实心图钉，「未固定」画线稿：
 * 同族字形、同一轮廓，语义由填充承担。
 */
function PinGlyph({ isPinned }: { readonly isPinned: boolean }) {
  const Glyph = isPinned ? PinFilledIcon : PinIcon

  return (
    <span
      aria-hidden="true"
      className="assistant-thread__glyph"
      data-pinned={isPinned ? 'true' : undefined}
    >
      <Glyph aria-hidden="true" />
    </span>
  )
}

interface RenameFieldProps {
  readonly initial: string
  readonly onCommit: (title: string) => void
  readonly onCancel: () => void
}

/*
 * 重命名中的那一行。
 *
 * 草稿住在这里，因为它是这一行的临时输入状态：此前它住在列表上，于是每敲
 * 一个字符整张列表连同每行的菜单根都要重渲一次。
 *
 * ref 用 useCallback 钉住标识。此前是内联箭头，每次渲染都是新函数，React
 * 因此每次都 detach 再 attach，于是每敲一个字符输入框就被整体全选一次——
 * 想在中间插字是插不进去的。挂载时选中一次，才是重命名该有的行为。
 */
function RenameField({ initial, onCommit, onCancel }: RenameFieldProps) {
  const [draft, setDraft] = useState(initial)

  const selectOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.select()
  }, [])

  const commit = () => {
    onCommit(draft)
  }

  return (
    <form
      className="assistant-thread__rename"
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <ThreadIcon aria-hidden="true" className="assistant-thread__icon" />

      <input
        aria-label="重命名会话"
        className="assistant-thread__rename-field"
        onBlur={commit}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        ref={selectOnMount}
        value={draft}
      />
    </form>
  )
}

interface ThreadRowProps {
  readonly thread: AssistantThreadSummary
  /** 已经算好的相对文案；无法解析的时刻是 null。 */
  readonly elapsed: string | null
  /** 同一时刻的准确说法，给悬停与读屏。 */
  readonly absolute: string | null
  readonly isActive: boolean
  readonly isRenaming: boolean
  readonly onActivate: (threadId: string) => void
  readonly onPin: (threadId: string, pinned: boolean) => void
  readonly onBeginRename: (threadId: string) => void
  readonly onCommitRename: (threadId: string, title: string) => void
  readonly onCancelRename: () => void
  readonly onDelete?: (threadId: string) => void
  readonly onOpenInNewTab?: (threadId: string) => void
}

/*
 * 时间以两个字符串进来，不是一个对象。
 *
 * 对象每次都是新引用，memo 会次次落空；传字符串，时钟跳动时只有文案真的
 * 变了的那几行才重渲——"3 天前"的行整晚不动。
 */
const ThreadRow = memo(function ThreadRow({
  thread,
  elapsed,
  absolute,
  isActive,
  isRenaming,
  onActivate,
  onPin,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onOpenInNewTab,
}: ThreadRowProps) {
  const isPinned = thread.isPinned === true
  const pinLabel = isPinned ? '取消固定' : '固定'

  const togglePin = () => {
    onPin(thread.id, !isPinned)
  }

  return (
    <li
      className="assistant-thread"
      data-active={isActive ? 'true' : undefined}
      data-muted={thread.isMuted === true ? 'true' : undefined}
      data-renaming={isRenaming ? 'true' : undefined}
    >
      {isRenaming ? (
        <RenameField
          initial={thread.title}
          onCancel={onCancelRename}
          onCommit={(title) => {
            onCommitRename(thread.id, title)
          }}
        />
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

          {/* 时间与操作共用这一个格子，谁可见由同一个判定决定。 */}
          <span className="assistant-thread__trail">
            {/*
                <time> 而不是 <span>：这一格说的是一个时刻，读屏软件与悬停都
                应当拿得到准确值，相对文案只是它的近似说法。
              */}
            {elapsed === null ? null : (
              <time
                className="assistant-thread__time"
                dateTime={thread.updatedAt}
                title={absolute ?? undefined}
              >
                {elapsed}
              </time>
            )}

            <span className="assistant-thread__actions">
              <button
                className="assistant-thread__action"
                onClick={togglePin}
                title={pinLabel}
                type="button"
              >
                <PinGlyph isPinned={isPinned} />
              </button>

              {/*
                  Not modal: a modal menu locks pointer events outside itself,
                  so the click that dismissed it was swallowed instead of
                  landing on the row it was aimed at.
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
                    the AI skin at this DOM boundary so the --cp-* tokens
                    survive leaving the sidebar subtree.
                  */}
                <DropdownMenuContent
                  align="end"
                  className="assistant-thread-menu assistant-menu-surface"
                  data-assistant-skin
                  side="bottom"
                  sideOffset={4}
                >
                  <DropdownMenuItem className="assistant-thread-menu__item" onClick={togglePin}>
                    <PinGlyph isPinned={isPinned} />
                    <span>{pinLabel}</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    className="assistant-thread-menu__item"
                    onClick={() => {
                      onBeginRename(thread.id)
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
  )
})

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
  /*
   * 时钟在这里进来一次，整张列表共用；每行不再各自读一次墙上时间。
   *
   * 同时告诉它这一屏下一次会变的时刻：它不按拍子轮询，睡到那一刻为止。
   */
  const now = useNow((at) => nextChangeIn(threads, at))
  const groups = sectionsOf(threads, now)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  /*
   * 首帧给出行的形状，不给结论。
   *
   * "还没有会话"是一个只有读完才成立的断言，把它当加载态显示，等于每次
   * 开窗都先告诉用户一件错误的事。骨架行是列表类界面的通行做法。
   */
  const showPlaceholders = isLoading === true && groups.length === 0

  const beginRename = useCallback((threadId: string) => {
    setRenamingId(threadId)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
  }, [])

  /* 提交只走这一条路：Enter 与失焦都到这里，空标题等于放弃。 */
  const commitRename = useCallback(
    (threadId: string, title: string) => {
      setRenamingId(null)

      const next = title.trim()

      if (next.length > 0) {
        onRename?.(threadId, next)
      }
    },
    [onRename],
  )

  return (
    <nav aria-label="AI 会话记录" className="assistant-threads" data-assistant-skin>
      <header className="assistant-threads__header">
        <span className="assistant-threads__caption">会话</span>

        <button
          aria-label="新建对话"
          className="assistant-threads__create"
          onClick={onCreate}
          title="新建对话"
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

      {groups.map((section) => (
        <section className="assistant-threads__group" key={section.id}>
          <span className="assistant-threads__caption">{section.label}</span>

          <ul className="assistant-threads__list">
            {section.members.map(({ instant, thread }) => (
              <ThreadRow
                absolute={Number.isNaN(instant) ? null : formatAbsolute(instant)}
                elapsed={Number.isNaN(instant) ? null : formatElapsed(instant, now)}
                isActive={thread.id === activeThreadId}
                isRenaming={thread.id === renamingId}
                key={thread.id}
                onActivate={onActivate}
                onBeginRename={beginRename}
                onCancelRename={cancelRename}
                onCommitRename={commitRename}
                onDelete={onDelete}
                onOpenInNewTab={onOpenInNewTab}
                onPin={onPin}
                thread={thread}
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
