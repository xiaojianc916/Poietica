import { IpcInvocationError, isIpcError } from './error'
import {
  type AgentConfigChoice,
  type AgentConfigControl,
  type AgentConfigPurpose,
  type AgentThread,
  commands,
} from './generated/ipc-bindings'

/**
 * The desktop implementation of the agent session port's two dependencies.
 *
 * It lives here rather than in the feature package because the feature layer
 * declares ports and must stay free of a desktop runtime. The application
 * composes the two.
 *
 * Frame shapes are never redefined here. Command payloads come from the
 * generated bindings, and the frames themselves are handed onwards as unknown
 * because the feature package validates every one of them before use.
 */

/** The channel run frames are broadcast on. */
export const AGENT_EVENT = 'ai-run-event'

/** 会话自己报来的选择器表走这一条。它不属于任何一轮，所以不与运行帧同流。 */
export const AGENT_SELECTOR_EVENT = 'ai-selector-report'

/**
 * The envelope the native side broadcasts.
 *
 * Only the frame is part of the event contract; the run identifier rides
 * outside it because it is routing, not content.
 */
interface AgentEventEnvelope {
  readonly runId: string
  readonly seq: number
  readonly kind: string
  readonly frame: unknown
}

export interface AgentEventSourceOptions {
  /** Reports a transport failure; listening is best-effort by design. */
  readonly onListenFailure?: (error: unknown) => void
}

export interface AgentEventSource {
  /**
   * Hands out the frame together with the run it belongs to.
   *
   * The envelope is not the frame contract, but the run identifier in it is the
   * only address that exists: the frames carry none. Dropping it here forced
   * every layer above to guess, so it is passed on as a separate argument —
   * routing beside content, not inside it.
   */
  readonly listen: (handler: (payload: unknown, runId: string) => void) => () => void
}

/** 起一个 agent 进程要说清的三件事。与原生侧的 AgentLaunch 同形。 */
export interface AgentLaunchDescription {
  /** 要启动的 agent。原生侧靠它决定受控 home 落在哪里。 */
  readonly agentId: string
  /** 可执行文件名或路径，不含参数。 */
  readonly program: string
  /** 传给它的参数，原样递给进程。 */
  readonly args: readonly string[]
}

export interface AgentBridgeOptions {
  /**
   * 这一次起哪个 agent。必填 —— 一个「少了就一定失败」的字段不该长成可选的。
   *
   * 此前这里是 agentId 与 command 两个可选字段，而组合层两处调用只送了后者：
   * 受控 home 因此在运行期一次都没生效过。类型上让它缺不了，比在原生侧兜底
   * 更早发现问题。
   *
   * 哪家 agent、哪个可执行文件、哪几个参数，全由 registry 的档案说了算，这一
   * 层不认识任何一家，也不再把它们拼成一行命令：拼起来再让对面切回去是有损的。
   */
  readonly launch: AgentLaunchDescription
  /** The working directory the session is created against. */
  readonly cwd?: string
}

export interface AgentCommandBridge {
  readonly prompt: (request: {
    readonly text: string
    /** The conversation the turn belongs to, where the interface named one. */
    readonly threadId?: string
  }) => Promise<{ readonly runId: string; readonly sessionId: string }>
  readonly cancel: (runId: string) => Promise<void>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
  readonly loadRun: (runId: string) => Promise<readonly unknown[]>
  readonly loadThread: (threadId: string) => Promise<readonly unknown[]>
}

/**
 * Subscribes to one native event.
 *
 * Unsubscribing has to be synchronous for the port, while Tauri's listener
 * registration is asynchronous, so a handle that arrives after the caller has
 * already given up is torn down immediately instead of leaking.
 *
 * 两条通道共用它。这段拆解此前只服务于运行帧一条，而第二条通道到来时照抄一遍，
 * 就是第二处要各自修的地方。
 */
function subscribeToEvent<TPayload>(
  event: string,
  handler: (payload: TPayload) => void,
  onListenFailure?: (error: unknown) => void,
): () => void {
  let cancelled = false
  let stop: (() => void) | null = null

  void import('@tauri-apps/api/event')
    .then((module) => module.listen<TPayload>(event, (received) => handler(received.payload)))
    .then((unlisten) => {
      if (cancelled) {
        unlisten()
        return
      }

      stop = unlisten
    })
    .catch((error: unknown) => {
      onListenFailure?.(error)
    })

  return () => {
    cancelled = true
    stop?.()
    stop = null
  }
}

/** Subscribes to run frames. */
export function createAgentEventSource({
  onListenFailure,
}: AgentEventSourceOptions = {}): AgentEventSource {
  return {
    listen: (handler) =>
      subscribeToEvent<AgentEventEnvelope>(
        AGENT_EVENT,
        (payload) => {
          // The frame is the contract; the run identifier is its address.
          handler(payload.frame, payload.runId)
        },
        onListenFailure,
      ),
  }
}

/** Turns a thrown IPC error into the package's error type. */
async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isIpcError(error)) {
      throw new IpcInvocationError(error)
    }

    throw error
  }
}

/*
 * 线上的形状。
 *
 * readonly string[] 与生成绑定要的 string[] 是不同的类型，所以数组在这里复制
 * 一次。字段改名也只发生在这里：它是唯一认识线上写法的一层。
 */
function nativeLaunch(launch: AgentLaunchDescription): {
  agentId: string
  program: string
  args: string[]
} {
  return { agentId: launch.agentId, program: launch.program, args: [...launch.args] }
}

/**
 * The command half of the port.
 *
 * Cancellation names the run it stops. 「一条会话同时只飞一轮」曾经被当成
 * 不必点名的理由，可地址要区分的从来不是同一条会话上的两轮，而是同一条连接
 * 上的两条会话：在 A 里按停止，停掉的是此刻在飞的 B。原生侧按 runId 查出它
 * 属于哪条会话，再把取消发给那一条。
 *
 * Answering a permission request is checked natively: an answer naming an
 * option the agent never offered is refused rather than acted on.
 */
export function createAgentCommandBridge({ launch, cwd }: AgentBridgeOptions): AgentCommandBridge {
  return {
    prompt: async (request) => {
      const result = await call(() =>
        commands.agentPrompt({
          text: request.text,
          threadId: request.threadId ?? null,
          launch: nativeLaunch(launch),
          cwd: cwd ?? null,
        }),
      )

      return { runId: result.runId, sessionId: result.sessionId }
    },

    cancel: async (runId) => {
      await call(() => commands.agentCancel({ runId }))
    },

    resolvePermission: async (requestId, optionId) => {
      await call(() => commands.agentResolvePermission({ requestId, optionId }))
    },

    loadRun: async (runId) => {
      const snapshot = await call(() => commands.agentLoadRun({ runId, afterSeq: null }))

      return snapshot.events
    },

    loadThread: async (threadId) => {
      /* null 就是整条。轮数上限属于窗口，而窗口已经不在了。 */
      const transcript = await call(() => commands.agentLoadThread({ threadId, recentRuns: null }))

      return transcript.events
    },
  }
}

/** Ends the session and lets the agent process exit. */
export async function shutdownAgent(): Promise<void> {
  await call(() => commands.agentShutdown())
}

/*
 * 改一项会话设置，一个命令。
 *
 * 没有"读"的那一路：选择器随会话一起回来（见下面的 open），改完之后 agent 又把
 * 整张表报回来。协议定义的东西不在这里重新定义，类别由 agent 说了算。 */

/**
 * What a selector is for, as far as the interface is concerned.
 *
 * 端口保留自己的名字，但集合只有一个定义：Rust 的 AgentConfigPurpose。agent
 * 自己发明的类别在原生侧就已经归入 other（见生成绑定里该类型的说明），这一层
 * 不再把同一个决定重做一遍。
 */
export type AgentConfigPurposeName = AgentConfigPurpose

export interface AgentConfigChoiceDescription {
  readonly value: string
  readonly label: string
  readonly detail?: string
}

export interface AgentConfigControlDescription {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly purpose: AgentConfigPurposeName
  readonly current: string
  readonly choices: readonly AgentConfigChoiceDescription[]
}

/*
 * 线上那条推送的形状。
 *
 * 原生侧的 AgentSelectorReport，camelCase 之后就是它。事件不是命令，specta 只
 * 认命令签名，所以它不在生成绑定里 —— 但里面那一格仍然取自生成绑定的
 * AgentConfigControl，形状没有第二个定义（这个文件开头就是这么说的）。
 */
interface AgentSelectorEnvelope {
  readonly sessionId: string
  readonly selectors: AgentConfigControl[]
}

/** 一条会话报来的整张表，以及它是哪条会话。 */
export interface AgentSelectorReport {
  readonly sessionId: string
  readonly controls: readonly AgentConfigControlDescription[]
}

export interface AgentSessionConfigBridge {
  readonly select: (
    threadId: string | null,
    configId: string,
    value: string,
  ) => Promise<readonly AgentConfigControlDescription[]>
  /**
   * agent 自己改了设置时，它会说。
   *
   * ACP 的 session/update 里有 config_option_update 这一档，agent 在一轮里换模型
   * 或换推理档位时走它。没有这一路，屏幕上的选择器只反映人最后点过的值，而真正
   * 在答话的是另一个 —— 那不是过时，那是界面在撒谎。
   */
  readonly subscribe: (handler: (report: AgentSelectorReport) => void) => () => void
}

/*
 * 线上说 null 表示缺席，端口说缺席就是没有这一格 —— 在 exactOptionalPropertyTypes
 * 下这是两个类型，所以这个键要么带值、要么不出现。
 *
 * 这句判断此前在 choiceOf 与 controlOf 里各写一遍。同一条规则写两遍，就会有一天
 * 只改了一遍。
 */
function detailOf(detail: string | null): { detail?: string } {
  return detail === null ? {} : { detail }
}

/*
 * 入参就是线上的类型本身。
 *
 * 这里曾经手抄着 NativeChoice 与 NativeControl，而这个文件开头写着 "Frame shapes
 * are never redefined here"。抄本还抄漏了一格：purpose 被写成 string，于是需要一个
 * purposeOf 把它再窄回四选一 —— 那段小写化防的是协议产生不了的值，那段 other 兜底
 * 则是把原生侧已经做过的决定又做了一遍。
 *
 * 出参仍然是端口自己的类型：防腐层不把生成类型泄给 feature 包。进来的用正本，
 * 出去的用端口，两边各只有一个定义。
 */
function choiceOf(native: AgentConfigChoice): AgentConfigChoiceDescription {
  return { value: native.value, label: native.label, ...detailOf(native.detail) }
}

function controlOf(native: AgentConfigControl): AgentConfigControlDescription {
  return {
    id: native.id,
    label: native.label,
    purpose: native.purpose,
    current: native.current,
    choices: native.choices.map(choiceOf),
    ...detailOf(native.detail),
  }
}

export function createAgentSessionConfigBridge({
  onListenFailure,
}: AgentEventSourceOptions = {}): AgentSessionConfigBridge {
  return {
    select: async (threadId, configId, value) => {
      const offered = await call(() => commands.agentSetConfigOption({ threadId, configId, value }))

      return offered.map(controlOf)
    },

    /* 线上叫 selectors，端口叫 controls；改名只发生在这一层。 */
    subscribe: (handler) =>
      subscribeToEvent<AgentSelectorEnvelope>(
        AGENT_SELECTOR_EVENT,
        (payload) => {
          handler({ sessionId: payload.sessionId, controls: payload.selectors.map(controlOf) })
        },
        onListenFailure,
      ),
  }
}

/*
 * 问这个 agent 提供什么，不点名任何一条对话。
 *
 * 命令早就生成好了（commands.agentCapabilities），此前这一层一个调用点都没有：
 * 原生侧砌好了门，TS 侧一次都没走过。它问的是连接自己的锚会话，不新开会话、
 * 不写库、不碰任何 thread。
 *
 * 形状不在这里重新定义：请求体来自生成绑定，答复复用 controlOf。
 */
export interface AgentCapabilityBridge {
  readonly read: () => Promise<readonly AgentConfigControlDescription[]>
}

export function createAgentCapabilityBridge({
  cwd,
  launch,
}: AgentBridgeOptions): AgentCapabilityBridge {
  return {
    read: async () => {
      const offered = await call(() =>
        commands.agentCapabilities({ launch: nativeLaunch(launch), cwd: cwd ?? null }),
      )

      return offered.map(controlOf)
    },
  }
}

/*
 * Conversations, reached through two ordinary commands.
 *
 * A conversation and an agent session are opened together, so no
 * identifier is invented here: both come back from the native side, and a
 * tab therefore always stands for something the agent knows about.
 */

/**
 * One conversation as the native side reports it.
 *
 * 这一格不做转换：list() 把生成绑定的 AgentThread 原样交出去，所以再手抄一份
 * "端口自己的类型"只是给同一个形状起了第二个名字。两份注释已经开始分叉了 ——
 * 这边写 titleSource 有 official 一档，生成绑定那边只列了 manual、message、
 * fallback。哪一份对要看 Rust 的 TitleSource；根源是同一件事被写了两遍。
 */
export type AgentThreadDescription = AgentThread

export interface AgentOpenedThreadDescription {
  readonly thread: AgentThreadDescription
  readonly selectors: readonly AgentConfigControlDescription[]
}

export interface AgentThreadBridge {
  readonly list: () => Promise<readonly AgentThreadDescription[]>
  /** 不点名就新开一条；点名就让那一条握住一个本次连接认得的会话。 */
  readonly open: (threadId?: string) => Promise<AgentOpenedThreadDescription>
  readonly rename: (threadId: string, title: string) => Promise<void>
  readonly remove: (threadId: string) => Promise<void>
  readonly setPinned: (threadId: string, pinned: boolean) => Promise<void>
}

export function createAgentThreadBridge({ launch, cwd }: AgentBridgeOptions): AgentThreadBridge {
  return {
    list: () => call(() => commands.agentThreads()),

    open: async (threadId) => {
      const opened = await call(() =>
        commands.agentOpenThread({
          threadId: threadId ?? null,
          launch: nativeLaunch(launch),
          cwd: cwd ?? null,
        }),
      )

      return {
        thread: opened.thread,
        selectors: opened.selectors.map(controlOf),
      }
    },

    rename: async (threadId, title) => {
      await call(() => commands.agentRenameThread({ threadId, title }))
    },

    remove: async (threadId) => {
      await call(() => commands.agentDeleteThread({ threadId }))
    },

    setPinned: async (threadId, pinned) => {
      await call(() => commands.agentPinThread({ threadId, pinned }))
    },
  }
}
