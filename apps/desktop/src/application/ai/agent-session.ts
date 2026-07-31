import type {
  AgentCapabilityPort,
  AgentSessionPort,
  SessionConfigPort,
  ThreadPort,
} from '@poietica/agent-protocol'
import {
  acpAgentById,
  acpAgentLaunch,
  defaultAcpAgent,
  parseAgentProviderListOutput,
} from '@poietica/agent-registry'
import { createIpcSession } from '@poietica/agent-transport'
import type { AgentConfigStore } from '@poietica/features-settings'
import { error as reportError } from '@poietica/foundations-observability'
import {
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
 * Nothing is adapted here, and there is nothing left to adapt: the bridge the
 * platform implements is the interface the transport itself declares. The two
 * compose by identity now, not by a structural match that merely happened to
 * hold — and a name that meant two different types in two packages is gone.
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
 * 「这一家 agent 配了哪些模型」，一个 agent 一份。
 *
 * 此前这里走 agent_capabilities：原生侧要先 ensure_session，也就是先起进程、先
 * 握手，而上游在开会话之前会查 default_model 可不可用，缺席就拒绝。于是"看清单"
 * 依赖"已经从清单里选好一个" —— 一台刚填完密钥的机器因此永远看不到模型，而屏幕上
 * 唯一的解释是一句 Authentication required。
 *
 * provider list --json 没有这个前提：一次子进程调用，读的就是 agent 那份
 * config.toml。设置页一直走的是它，现在选择器也走它，同一个问题只剩一个产地。
 *
 * 按 agentId 记住那个对象，因为端口的身份就是 store 判断"换没换一家"的依据：每次
 * 渲染新建一个，等于每开一格对话都把清单重问一遍。
 */
const modelSources = new Map<string, AgentCapabilityPort>()

export function desktopAgentModels(store: AgentConfigStore, agentId: string): AgentCapabilityPort {
  const held = modelSources.get(agentId)

  if (held !== undefined) {
    return held
  }

  const source: AgentCapabilityPort = {
    read: async () => {
      /* 问什么、哪个 id 是环境变量合成的保留条目，都写在 agent 的档案里。 */
      const descriptor = acpAgentById(agentId)
      const listArgs = descriptor?.providerListArgs

      if (descriptor === undefined || listArgs === undefined) {
        throw new Error(`${agentId} 没有声明查询模型清单的子命令。`)
      }

      const outcome = await store.execCli({
        agentId,
        args: [...listArgs],
        secretVar: '',
        secretValue: '',
      })

      /*
       * 非零退出时把 agent 自己的 stderr 原样上屏。config.toml 坏了的时候它说得比
       * 我们清楚 —— 连怎么修都告诉你 —— 转述一遍只会丢信息。
       */
      if (outcome.status !== 0) {
        const said = outcome.stderr.trim()

        throw new Error(said.length === 0 ? `agent 以 ${outcome.status} 退出。` : said)
      }

      const snapshot = parseAgentProviderListOutput(outcome.stdout, descriptor.syntheticProviderId)

      /* 没配凭据的那一家给不出答案：列出它的模型，只是让人挑一个必定失败的。 */
      return snapshot.providers
        .filter((provider) => provider.configured)
        .flatMap((provider) =>
          provider.models.map((model) => ({ value: model.alias, label: model.displayName })),
        )
    },
  }

  modelSources.set(agentId, source)

  return source
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
