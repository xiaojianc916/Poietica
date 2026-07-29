import '../assistant-card.css'

import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import {
  ChevronDownIcon,
  FailureIcon,
  FileIcon,
  GlobeIcon,
  ModelIcon,
  PencilIcon,
  SearchIcon,
  SpinnerIcon,
  ToolIcon,
} from '../primitives/icons'
import { toDiffStat, toToolContentParts } from './tool-call-content'

function ToolKindIcon({ kind }: { readonly kind: ToolCallTimelineItem['kind'] }) {
  const className = 'timeline-tool__icon'

  switch (kind) {
    case 'edit':
      return <PencilIcon aria-hidden="true" className={className} />
    case 'delete':
    case 'move':
      return <FileIcon aria-hidden="true" className={className} />
    case 'read':
    case 'search':
      return <SearchIcon aria-hidden="true" className={className} />
    case 'fetch':
      return <GlobeIcon aria-hidden="true" className={className} />
    case 'think':
      return <ModelIcon aria-hidden="true" className={className} />
    default:
      return <ToolIcon aria-hidden="true" className={className} />
  }
}

/**
 * One tool call, from the moment it is announced to the moment it settles.
 *
 * The title is the agent's own words and changes as work proceeds — Kimi sends
 * "Read" and then "Reading README.md" — so it is displayed rather than
 * reconstructed from the arguments.
 *
 * Collapsed by default, because a finished read of a file is a fact and not a
 * story. A failure opens itself: nobody has to hunt for the reason.
 *
 * Opening is the same drawer the thought chain uses: the body stays mounted and
 * a grid row travels between 0fr and 1fr, so a card that opens by itself on
 * failure travels rather than jumps. Closed, the body is inert.
 */
export function ToolCallCard({ item }: { readonly item: ToolCallTimelineItem }) {
  const { isOpen, toggle } = useDisclosure(item.status === 'failed')
  const parts = toToolContentParts(item.content)
  const diffStat = toDiffStat(parts)
  const isRunning = item.status === 'pending' || item.status === 'in_progress'

  return (
    <section
      className="assistant-card timeline-tool"
      data-open={isOpen ? 'true' : undefined}
      data-status={item.status}
    >
      <button
        aria-expanded={isOpen}
        className="timeline-tool__header"
        onClick={toggle}
        type="button"
      >
        <ToolKindIcon kind={item.kind} />

        <span className="timeline-tool__title">{item.title}</span>

        {diffStat === null || diffStat.added + diffStat.removed === 0 ? null : (
          <span className="timeline-tool__diffstat">
            {diffStat.added > 0 ? (
              <span className="timeline-tool__diffstat-added">+{diffStat.added}</span>
            ) : null}
            {diffStat.removed > 0 ? (
              <span className="timeline-tool__diffstat-removed">-{diffStat.removed}</span>
            ) : null}
          </span>
        )}

        {isRunning ? <SpinnerIcon aria-hidden="true" className="timeline-tool__spinner" /> : null}

        {/*
         * 结束状态只画，不说。
         *
         * 成功不需要一行「已完成」：卡片在那儿、纺锤停了，就是完成了。运行中
         * 也不需要「执行中」：纺锤正在转。四种状态里只有失败带着新消息，所以
         * 它是唯一留下的记号 —— 一个图标，不染色（原因由自动展开的内容负责
         * 说清楚），带 aria-label，读屏仍然听得到。
         */}
        {item.status === 'failed' ? (
          <FailureIcon aria-label="失败" className="timeline-tool__failed" role="img" />
        ) : null}

        <ChevronDownIcon aria-hidden="true" className="timeline-tool__chevron" />
      </button>

      <DisclosureBody block="timeline-tool" isOpen={isOpen}>
        <div className="timeline-tool__body">
          {item.locations.length > 0 ? (
            <ul className="timeline-tool__locations">
              {item.locations.map((location) => (
                <li className="timeline-tool__location" key={location.path}>
                  {location.path}
                  {location.line === undefined ? null : `:${String(location.line)}`}
                </li>
              ))}
            </ul>
          ) : null}

          {parts.length === 0 ? (
            <p className="timeline-tool__empty">这次调用没有返回内容。</p>
          ) : null}

          {parts.map((part, index) => {
            const key = `${part.type}:${String(index)}`

            if (part.type === 'text') {
              return (
                <pre className="timeline-tool__text" key={key}>
                  {part.text}
                </pre>
              )
            }

            if (part.type === 'diff') {
              return (
                <div className="timeline-tool__diff" key={key}>
                  <p className="timeline-tool__diff-path">{part.path}</p>
                  {part.oldText === null ? (
                    <p className="timeline-tool__diff-note">新建文件</p>
                  ) : (
                    <pre className="timeline-tool__diff-old">{part.oldText}</pre>
                  )}
                  <pre className="timeline-tool__diff-new">{part.newText}</pre>
                </div>
              )
            }

            if (part.type === 'terminal') {
              return (
                <p className="timeline-tool__terminal" key={key}>
                  终端 {part.terminalId}
                </p>
              )
            }

            return (
              <p className="timeline-tool__opaque" key={key}>
                {part.label}
              </p>
            )
          })}
        </div>
      </DisclosureBody>
    </section>
  )
}
