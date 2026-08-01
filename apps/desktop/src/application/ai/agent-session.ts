import type {
  AgentCapabilityPort,
  AgentSessionPort,
  SessionConfigChoice,
  SessionConfigControl,
  SessionConfigPort,
  ThreadPort,
} from '@poietica/acp'
import { createIpcSession } from '@poietica/acp'
import {
  acpAgentById,
  acpAgentLaunch,
  defaultAcpAgent,
  parseAgentProviderListOutput,
} from '@poietica/agent-registry'
import {
  createAgentCapabilityBridge,
  createAgentCommandBridge,
  createAgentEventSource,
  createAgentSessionConfigBridge,
  createAgentThreadBridge,
  shutdownAgent,
} from '@poietica/ipc'
import { error as reportError } from '@poietica/observability'
import type { AgentConfigStore } from '@poietica/settings'

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
 * /*
 * 「这一家 agent 提供哪些可调项」，一个 agent 一份。
 *
 * 两个产地一张表，因为两件事的前提不同：
 *
 *   · 模型清单：agent 自己的 CLI（provider list --json）。一次子进程调用，读的就是
 *     它那份 config.toml，不需要会话 —— 这正是 0cbf5bc 修掉的那个死锁（上游在开会话
 *     之前先查 default_model 可不可用，于是"看清单"曾被架在"已经选好一个"之上）。
 *   · 模式与推理档位：只有 agent 说得出来。ACP 的 session/new 是唯一权威，原生侧
 *     agent_capabilities 问的是连接自带的锚会话，不新开会话、不写库、不碰 thread。
 *
 * 锚会话要有一个可用的 default_model 才开得起来，所以它排在清单之后，而且失败不
 * 连坐：清单还在，少两项选择器好过一项都没有 —— 但要说出来，不是默不作声。配置里
 * 第一次被补上 default_model 时，capability store 会把这一路重问一次。
 *
 * 按 agentId 记住那个对象，因为端口的身份就是 store 判断"换没换一家"的依据。
 */
const capabilities = new Map<string, AgentCapabilityPort>()

/* 模型那一格由这里合成：id 与 purpose 都是协议里那个字面量。 */
const MODEL_CONTROL: Pick<SessionConfigControl, 'id' | 'label' | 'purpose'> = {
  id: 'model',
  label: '模型',
  purpose: 'model',
}

export function desktopAgentCapabilities(
  store: AgentConfigStore,
  agentId: string,
): AgentCapabilityPort {
  const held = capabilities.get(agentId)

  if (held !== undefined) {
    return held
  }

  const anchor = createAgentCapabilityBridge({
    launch: acpAgentLaunch(acpAgentById(agentId) ?? defaultAcpAgent()),
  })

  const source: AgentCapabilityPort = {
    read: async () => {
      const choices = await readModels(store, agentId)

      const offered = await anchor.read().catch((cause: unknown) => {
        reportError('the agent did not report its selectors', {
          scope: 'agent-session',
          operation: 'read-capabilities',
          cause,
        })

        return []
      })

      /* 模型那一项在这里成形：清单归 CLI，其余归 agent，两边不重叠。 */
      const rest = offered.filter((control) => control.purpose !== 'model')

      if (choices.length === 0) {
        return rest
      }

      return [{ ...MODEL_CONTROL, current: choices[0]?.value ?? '', choices }, ...rest]
    },
  }

  capabilities.set(agentId, source)

  return source
}

/** 这一家配了哪些模型。没配凭据的那一家不列 —— 挑一个必定失败的没有意义。 */
async function readModels(
  store: AgentConfigStore,
  agentId: string,
): Promise<readonly SessionConfigChoice[]> {
  /* 问什么、哪个 id 是环境变量合成的保留条目，都写在 agent 的档案里。 */
  const descriptor = acpAgentById(agentId)
  const listArgs = descriptor?.providerListArgs

  if (descriptor === undefined || listArgs === undefined) {
    throw new Error(`${agentId} 没有声明查询模型清单的子命令。`)
  }

  const outcome = await store.execCli({
    agentId,
    args: [...listArgs],
  })

  /*
   * 非零退出时把 agent 自己的 stderr 原样上屏。config.toml 坏了的时候它说得比我们
   * 清楚 —— 连怎么修都告诉你 —— 转述一遍只会丢信息。
   */
  if (outcome.status !== 0) {
    const said = outcome.stderr.trim()

    throw new Error(said.length === 0 ? `agent 以 ${outcome.status} 退出。` : said)
  }

  const snapshot = parseAgentProviderListOutput(outcome.stdout, descriptor.syntheticProviderId)

  return snapshot.providers
    .filter((provider) => provider.configured)
    .flatMap((provider) =>
      provider.models.map((model) => ({ value: model.alias, label: model.displayName })),
    )
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
