import './assistant-composer.css'

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
}

export function AssistantThreadList({
  threads,
  activeThreadId,
  onActivate,
  onCreate,
  onPin,
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

                    <button
                      aria-label="更多操作"
                      className="assistant-thread__action"
                      title="更多操作"
                      type="button"
                    >
                      <MoreIcon aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
