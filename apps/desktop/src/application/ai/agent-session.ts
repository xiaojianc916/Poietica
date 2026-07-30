import type {
  AgentCapabilityPort,
  AgentSessionPort,
  SessionConfigPort,
  ThreadPort,
} from '@poietica/agent-protocol'
import { acpAgentLaunch, defaultAcpAgent } from '@poietica/agent-registry'
import { installAgentCapabilityPort } from '@poietica/agent-runtime'
import { createIpcSession } from '@poietica/agent-transport'
import { error as reportError } from '@poietica/foundations-observability'
import {
  createAgentCapabilityBridge,
  createAgentCommandBridge,
  createAgentEventSource,
  createAgentSessionConfigBridge,
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
  sessionConfig ??= createAgentSessionConfigBridge()

  return sessionConfig
}

/*
 * 能力表那一路，整个进程一份。
 *
 * 桥是无状态的问答口，可它握着一条 IPC 通道；而能力表本身是全进程共用的一张表，
 * 每次渲染新建一座桥只会让同一张表被问上好几遍。
 */
let capabilities: AgentCapabilityPort | undefined

export function desktopAgentCapabilities(): AgentCapabilityPort {
  capabilities ??= createAgentCapabilityBridge({ launch: acpAgentLaunch(defaultAcpAgent()) })

  return capabilities
}

/**
 * 把能力端口交给 store。
 *
 * 只是交出去，不在这里问：进程要等到屏幕上真有一个选择器要画时才起。读失败会被
 * 说出来，然后停在缓存那一份上 —— 缓存是离线兜底，不是取数路径。
 */
export function installDesktopAgentCapabilities(): void {
  installAgentCapabilityPort(desktopAgentCapabilities(), (cause) => {
    reportError('agent capabilities could not be read', {
      scope: 'agent-session',
      operation: 'capabilities',
      cause,
    })
  })
}

export interface DesktopAgentSession {
  readonly port: AgentSessionPort
  /** Ends the session and lets the agent process exit. */
  readonly dispose: () => Promise<void>
}

export function createDesktopAgentSession(): DesktopAgentSession {
  const port = createIpcSession({
    bridge: createAgentCommandBridge({ launch: acpAgentLaunch(defaultAcpAgent()) }),

    source: createAgentEventSource({
      onListenFailure: (cause) => {
        reportError('agent event subscription failed', {
          scope: 'agent-session',
          operation: 'listen',
          cause,
        })
      },
    }),
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
  const bridge = createAgentThreadBridge({ launch: acpAgentLaunch(defaultAcpAgent()) })

  /*
   * 原样交出去，这也是这个文件开头就声明过的事（Nothing is adapted here）。
   *
   * titleSource 在两边现在是同一个三值闭集，没有一个字段需要改名或改档。此前
   * 这里对每一行跑一次收窄、再把整张表 spread 重建一遍 —— 那次收窄之所以存在,
   * 只是因为绑定把一个闭集写成了 string，而它认的第四档平台早就不发了。
   */
  return bridge
}
