import type {
  AgentCapabilityPort,
  SessionConfigChoice,
  SessionConfigControl,
  SessionConfigPort,
  ThreadPort,
} from '@poietica/acp'
import type { AgentCommandBridge, AgentEventSource } from './acp-session'
import { throughIpc } from './error'
import { type AgentConfigChoice, type AgentConfigControl, commands } from './generated/ipc-bindings'

/**
 * The desktop implementation of the ports the feature layer declares.
 *
 * It lives here rather than in the feature package because the feature layer
 * declares ports and must stay free of a desktop runtime. The application
 * composes the two.
 *
 * 端口不在这一层重新声明一遍。ThreadPort / SessionConfigPort / AgentCapabilityPort
 * 就是下面几个工厂的返回类型，所以「桥」与「端口」是同一个名字下的同一样东西。
 *
 * 此前这里另立了一整套 *Description 与 *Bridge：字段与端口逐格相同，组合层因此
 * 编译得过 —— 靠的是两份手写接口今天恰好一样，而不是同一个定义。同一个形状有了
 * 第二个名字，注释立刻就分叉了：那份 AgentThreadDescription 说 titleSource 有
 * official 一档，而 ThreadTitleSource 与生成绑定的 AgentTitleSource 都只有三档,
 * 后者的文档还专门写着 official 是被删掉的那一档。抄本没有承担任何转换，它只是
 * 一份会过期的说明。
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
 * 信封就是帧：判别式、位置、时刻与载荷平铺在同一层，会话号也在这一层 ——
 * 六种帧无一例外都自报它（见原生侧 recorder.rs 的 RecordedEvent）。
 *
 * 帧此前被套在一个 frame 字段里，而外面那层另抄了一份 seq 与 kind。两份都
 * 没有任何人读过：下面这个 listen 只取 frame 与 sessionId，而 RunEvent
 * 压根没有 sessionId 这一格。它们只是每一帧都要在线上多走一趟。
 *
 * 线上一次带的是一批，不是一个。原生侧按屏幕的节拍攒帧（见 commands/agent.rs
 * 的 batched），所以跨进程往返的次数不再随 agent 说得多快而涨。信封本身的形状
 * 没有变，端口交出去的仍然是一帧一次。
 */
interface AgentEventEnvelope {
  readonly sessionId: string
}

export interface AgentEventSourceOptions {
  /** Reports a transport failure; listening is best-effort by design. */
  readonly onListenFailure?: (error: unknown) => void
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
   *
   * 交的是一次求值，不是一个值。桥在启动时就建好，而「用哪一家」要等落盘的配置
   * 读回来才知道，之后还会被设置页改掉：捕获建桥那一刻的答案，等于把第一帧的
   * 猜测钉死一整个进程。
   */
  readonly launch: () => AgentLaunchDescription
  /** The working directory the session is created against. */
  readonly cwd?: string
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
      subscribeToEvent<readonly AgentEventEnvelope[]>(
        AGENT_EVENT,
        (payload) => {
          /* 一拍的帧一起到。攒批发生在原生侧，端口这一层仍然一帧一次。 */
          for (const frame of payload) {
            // 帧就是信封；会话号是它自报的地址。
            handler(frame, frame.sessionId)
          }
        },
        onListenFailure,
      ),
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
 * Cancellation names the conversation it stops. 地址要区分的从来不是同一条
 * 会话上的两轮，而是同一条连接上的两条会话：在 A 里按停止，不该停掉此刻在飞
 * 的 B。这一层因此点名对话，原生侧按它查出握着哪条会话 —— 那条对应关系在打开
 * 对话时就写下了，此前那个轮次号是为同一件事另造的第二个地址。
 *
 * Answering a permission request is checked natively: an answer naming an
 * option the agent never offered is refused rather than acted on.
 */
export function createAgentCommandBridge({ launch, cwd }: AgentBridgeOptions): AgentCommandBridge {
  return {
    prompt: async (request) => {
      const result = await throughIpc(() =>
        commands.agentPrompt({
          text: request.text,
          threadId: request.threadId,
          launch: nativeLaunch(launch()),
          cwd: cwd ?? null,
        }),
      )

      return { sessionId: result.sessionId }
    },

    cancel: async (threadId) => {
      await throughIpc(() => commands.agentCancel({ threadId }))
    },

    resolvePermission: async (requestId, optionId) => {
      await throughIpc(() => commands.agentResolvePermission({ requestId, optionId }))
    },
  }
}

/** Ends the session and lets the agent process exit. */
export async function shutdownAgent(): Promise<void> {
  await throughIpc(() => commands.agentShutdown())
}

/*
 * 改一项会话设置，一个命令。
 *
 * 没有"读"的那一路：选择器随会话一起回来（见下面的 open），改完之后 agent 又把
 * 整张表报回来。协议定义的东西不在这里重新定义，类别由 agent 说了算。
 */

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
 * 进来的是线上的类型本身，出去的是端口的类型本身。
 *
 * 这里曾经手抄着 NativeChoice 与 NativeControl，而这个文件开头写着 "Frame shapes
 * are never redefined here"。抄本还抄漏了一格：purpose 被写成 string，于是需要一个
 * purposeOf 把它再窄回四选一 —— 那段小写化防的是协议产生不了的值，那段 other 兜底
 * 则是把原生侧已经做过的决定又做了一遍。
 *
 * 出参此前也是抄本（AgentConfigControlDescription），与 SessionConfigControl 逐格
 * 相同。今天两头都只有一个定义：线上一个，端口一个，中间只剩 detail 那一格真正的
 * 转换。purpose 不需要任何处理 —— AgentConfigPurpose 与 SessionConfigPurpose 是同
 * 一个四值集，原生侧已经把 agent 自己发明的类别归进了 other。
 */
function choiceOf(native: AgentConfigChoice): SessionConfigChoice {
  return { value: native.value, label: native.label, ...detailOf(native.detail) }
}

function controlOf(native: AgentConfigControl): SessionConfigControl {
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
}: AgentEventSourceOptions = {}): SessionConfigPort {
  return {
    select: async (threadId, configId, value) => {
      const offered = await throughIpc(() =>
        commands.agentSetConfigOption({ threadId, configId, value }),
      )

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
 * 它问的是连接自带的锚会话：不新开会话、不写库、不碰任何 thread。模型清单不走
 * 这里（那条路要先有一个可用的 default_model，见 app 层的 desktopAgentCapabilities），
 * 这一路要的是模式与推理档位 —— 那两项只有 agent 说得出来，ACP 的 session/new
 * 是它们唯一的权威。
 *
 * 形状不在这里重新定义：请求体来自生成绑定，答复复用 controlOf，返回的就是
 * 组合层要的那个端口。
 */
export function createAgentCapabilityBridge({
  cwd,
  launch,
}: AgentBridgeOptions): AgentCapabilityPort {
  return {
    read: async () => {
      const offered = await throughIpc(() =>
        commands.agentCapabilities({ launch: nativeLaunch(launch()), cwd: cwd ?? null }),
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
 *
 * 一条对话长什么样、它的经过为什么是现在这个样子，两个形状都由端口定义
 * （ThreadRecord 与 ThreadHistory）。生成绑定的 AgentThread 与 AgentHistory
 * 逐格与它们相同，所以这里原样交出去，不复制、不改名、也不再抄一份说明。
 */
export function createAgentThreadBridge({ launch, cwd }: AgentBridgeOptions): ThreadPort {
  return {
    list: () => throughIpc(() => commands.agentThreads()),

    open: async (threadId) => {
      const opened = await throughIpc(() =>
        commands.agentOpenThread({
          threadId: threadId ?? null,
          launch: nativeLaunch(launch()),
          cwd: cwd ?? null,
        }),
      )

      return {
        thread: opened.thread,
        selectors: opened.selectors.map(controlOf),
        events: opened.events,
        history: opened.history,
      }
    },

    rename: async (threadId, title) => {
      await throughIpc(() => commands.agentRenameThread({ threadId, title }))
    },

    remove: async (threadId) => {
      await throughIpc(() => commands.agentDeleteThread({ threadId }))
    },

    setPinned: async (threadId, pinned) => {
      await throughIpc(() => commands.agentPinThread({ threadId, pinned }))
    },
  }
}
