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
 * 改会话设置的那一路，整个进程一份。
 *
 * 它是无状态的：一次改动就是一次往返，agent 把改完的整张表报回来。没有读，所以
 * 这里没有任何缓存可言，一个实例够了；每次渲染新建一个对象只会让下游的依赖数组
 * 每帧都变。
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
let threads: ThreadPort | undefined

export function desktopThreads(): ThreadPort {
  threads ??= buildThreadPort()

  return threads
}

/*
 * 一个进程一座桥。
 *
 * 桥是无状态的问答口，可它握着一条 IPC 通道：每次调用都新建一座，就等于每个
 * 读会话列表的地方各自问一遍，同一份列表被读了不止一次。
 */
function buildThreadPort(): ThreadPort {
  const bridge = createAgentThreadBridge({ command: defaultAcpAgent().command })

  return {
    list: async () => {
      const found = await bridge.list()

      return found.map((thread) => ({
        ...thread,
        titleSource: sourceOf(thread.titleSource),
      }))
    },

    open: async (threadId) => {
      const opened = await bridge.open(threadId)

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
