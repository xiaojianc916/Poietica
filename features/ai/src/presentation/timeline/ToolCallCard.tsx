import type { ToolCallTimelineItem } from '../../contracts/timeline-contract'
import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import {
  ChevronDownIcon,
  FileIcon,
  GlobeIcon,
  ModelIcon,
  SearchIcon,
  SpinnerIcon,
  ToolsIcon,
} from '../primitives/icons'
import { toToolContentParts } from './tool-call-content'

const STATUS_LABELS: Record<ToolCallTimelineItem['status'], string> = {
  completed: '已完成',
  failed: '失败',
  in_progress: '执行中',
  pending: '等待中',
}

function ToolKindIcon({ kind }: { readonly kind: ToolCallTimelineItem['kind'] }) {
  const className = 'timeline-tool__icon'

  switch (kind) {
    case 'delete':
    case 'edit':
    case 'move':
    case 'read':
      return <FileIcon aria-hidden="true" className={className} />
    case 'search':
      return <SearchIcon aria-hidden="true" className={className} />
    case 'fetch':
      return <GlobeIcon aria-hidden="true" className={className} />
    case 'think':
      return <ModelIcon aria-hidden="true" className={className} />
    default:
      return <ToolsIcon aria-hidden="true" className={className} />
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
  const isRunning = item.status === 'pending' || item.status === 'in_progress'

  return (
    <section
      className="timeline-tool"
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

        {isRunning ? <SpinnerIcon aria-hidden="true" className="timeline-tool__spinner" /> : null}

        <span className="timeline-tool__status">{STATUS_LABELS[item.status]}</span>

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
