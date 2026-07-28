import type {
  AgentSessionPort,
  SessionConfigPort,
  ThreadPort,
  ThreadTitleSource,
} from '@poietica/agent-protocol'
import { defaultAcpAgent } from '@poietica/agent-registry'
import { createIpcSession } from '@poietica/agent-transport'
import { error as reportError } from '@poietica/foundations-observability'
import {
  createAgentCommandBridge,
  createAgentConfigBridge,
  createAgentEventSource,
  createAgentThreadBridge,
  shutdownAgent,
} from '@poietica/platforms-desktop-ipc'

/*
 * Where the agent session port is actually built.
 *
 * The feature package declares the port and the platform package implements
 * its two halves; neither knows about the other. This file is the only place
 * they meet, which is why it lives in the app and not in either of them.
 *
 * Nothing is adapted here. The desktop bridge accepts a narrower prompt
 * request than the port declares, which is exactly the direction that type
 * checks, so the two compose directly rather than through a translation layer
 * that could drift.
 */

/*
 * The session selectors, offered once for the whole process.
 *
 * Stateless in the same way the model port is, for a different reason:
 * the list is not a file but the running session answering for itself, so
 * every read is a fresh question and one instance is enough. A fresh
 * object per render would mean a fresh question per render.
 */
let sessionConfig: SessionConfigPort | undefined

export function desktopSessionConfig(): SessionConfigPort {
  sessionConfig ??= createAgentConfigBridge()

  return sessionConfig
}

export interface DesktopAgentSession {
  readonly port: AgentSessionPort
  /** Ends the session and lets the agent process exit. */
  readonly dispose: () => Promise<void>
}

export function createDesktopAgentSession(): DesktopAgentSession {
  const port = createIpcSession({
    bridge: createAgentCommandBridge({ command: defaultAcpAgent().command }),

    source: createAgentEventSource({
      onListenFailure: (cause) => {
        reportError('agent event subscription failed', {
          scope: 'agent-session',
          operation: 'listen',
          cause,
        })
      },
    }),

    /*
     * An agent is untrusted input even when it speaks a standard protocol. A
     * frame that fails validation is reported and dropped, never merged into
     * the timeline, and never silent.
     */
    onInvalidFrame: (issue, payload) => {
      reportError('agent sent a frame the renderer refused', {
        scope: 'agent-session',
        operation: 'validate-frame',
        cause: { issue, payload },
      })
    },
  })

  return {
    port,

    dispose: async () => {
      try {
        await shutdownAgent()
      } catch (cause: unknown) {
        // A window is closing. A failed shutdown is worth a log and nothing
        // more; the process is going away regardless.
        reportError('agent shutdown failed', {
          scope: 'agent-session',
          operation: 'shutdown',
          cause,
        })
      }
    },
  }
}

/**
 * Narrows the recorded origin of a name.
 *
 * A value this build does not recognise is treated as a fallback rather
 * than trusted: showing AI is honest, whereas calling an unknown string
 * official would claim the agent named a conversation it never named.
 */
function sourceOf(value: string): ThreadTitleSource {
  if (value === 'official' || value === 'manual' || value === 'message') {
    return value
  }

  return 'fallback'
}

/** The desktop implementation of the conversation port. */
export function desktopThreads(): ThreadPort {
  const bridge = createAgentThreadBridge({ command: defaultAcpAgent().command })

  return {
    list: async () => {
      const found = await bridge.list()

      return found.map((thread) => ({
        ...thread,
        titleSource: sourceOf(thread.titleSource),
      }))
    },

    open: async () => {
      const opened = await bridge.open()

      return {
        thread: {
          ...opened.thread,
          titleSource: sourceOf(opened.thread.titleSource),
        },
        selectors: opened.selectors,
      }
    },

    rename: bridge.rename,
    remove: bridge.remove,
    setPinned: bridge.setPinned,
  }
}
