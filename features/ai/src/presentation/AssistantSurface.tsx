import './assistant-composer.css'

import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useId } from 'react'

import { AgentActivityFeed } from './AgentActivityFeed'
import { AssistantComposer } from './AssistantComposer'
import { TimelineRow } from './timeline/TimelineRow'
import { AssistantQuickActions } from './AssistantQuickActions'
import { PermissionRequest } from './PermissionRequest'
import { AgentIcon } from './primitives/icons'
import type { AgentSessionPort } from '../contracts/agent-session-port'
import { selectFeedRows, selectIsBusy } from '../domain/timeline-selectors'
import { useAssistantSession } from '../application/useAssistantSession'

export interface AssistantSurfaceProps {
  readonly endpoint: string
  /**
   * The session this surface talks to.
   *
   * Optional on purpose: without one the surface renders against an inert
   * stub, which is what fixtures and component work need. The desktop app
   * supplies the real IPC-backed port.
   */
  readonly session?: AgentSessionPort
}

/*
 * One curve for the whole surface.
 *
 * Starting a turn is a real layout change: the column stops being centred and
 * the feed claims the free space, which is why the composer ends up near the
 * bottom without ever being positioned there. That change cannot be
 * interpolated by CSS, so the moving parts are measured before and after it
 * and the difference is animated with transforms instead.
 */
const SETTLE = { duration: 0.34, ease: 'easeInOut' } as const

/** Leaving is quicker than arriving; nobody studies an element on its way out. */
const LEAVE = { opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeIn' } } as const

const ARRIVED = { opacity: 1, y: 0 }
const OFFSET = { opacity: 0, y: 12 }

/**
 * Masthead, feed, composer and starters are siblings in one column bound to
 * --cp-grid, so their edges align by construction.
 *
 * The surface has exactly two resting states, and the first row of the feed is
 * what decides which one applies. Nothing here tracks whether a turn was ever
 * sent: a state derived from the timeline cannot disagree with it.
 */
export function AssistantSurface({ endpoint, session }: AssistantSurfaceProps) {
  /*
   * Under exactOptionalPropertyTypes an absent property and a property set to
   * undefined are different types, so the key is omitted rather than passed
   * empty.
   */
  const assistant = useAssistantSession({
    endpoint,
    ...(session === undefined ? {} : { session }),
  })

  const rows = selectFeedRows(assistant.timeline)
  const started = rows.length > 0

  const columnId = `${useId()}-column`

  return (
    <MotionConfig reducedMotion="user">
      <section
        className="assistant-surface"
        data-assistant-skin
        data-started={started ? 'true' : undefined}
      >
        <motion.div className="assistant-surface__column" id={columnId} layout transition={SETTLE}>
          <AnimatePresence initial={false}>
            {started ? null : (
              <motion.header className="assistant-masthead" exit={LEAVE} key="masthead" layout>
                <AgentIcon aria-hidden="true" className="assistant-masthead__mark" />

                <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
              </motion.header>
            )}
          </AnimatePresence>

          {started ? (
            <motion.div
              animate={ARRIVED}
              className="assistant-surface__feed"
              initial={OFFSET}
              layout
              transition={SETTLE}
            >
              <AgentActivityFeed
                isBusy={selectIsBusy(assistant.timeline)}
                renderRow={(row) =>
                  row.item.type === 'permission' ? (
                    <PermissionRequest item={row.item} onResolve={assistant.resolvePermission} />
                  ) : (
                    <TimelineRow row={row} />
                  )
                }
                rows={rows}
              />
            </motion.div>
          ) : null}

          <motion.div className="assistant-surface__composer" layout transition={SETTLE}>
            <AssistantComposer
              agentLabel="Super Computer"
              columnId={columnId}
              isAgentNew
              onSubmit={assistant.send}
              status={assistant.status}
            />
          </motion.div>

          <AnimatePresence initial={false}>
            {started ? null : (
              <motion.div
                className="assistant-surface__starters"
                exit={LEAVE}
                key="starters"
                layout
              >
                <AssistantQuickActions onSelect={() => {}} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </section>
    </MotionConfig>
  )
}
