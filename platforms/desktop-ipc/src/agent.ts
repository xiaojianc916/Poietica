import { IpcInvocationError, isIpcError } from './error'
import { commands } from './generated/ipc-bindings'

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
  readonly listen: (handler: (payload: unknown) => void) => () => void
}

export interface AgentBridgeOptions {
  /**
   * 这一次要用哪一家 agent，由 registry 的档案说了算；不点名就交给原生兜底。
   *
   * 原生那侧的 agent_prompt 与 agent_open_thread 已经要求这一项，而这一层此前
   * 从未送过它：typecheck 因此一直红着，运行期则每一次发言、每一次开对话都在
   * 走兜底路径，界面选了哪一家根本没有传下去。
   */
  readonly agentId?: string
  /**
   * 启动 agent 的一整行命令行，例如 `kimi acp`。
   *
   * 是「一行」而不是「可执行文件名」：原生侧把它交给 agent-client-protocol 的
   * AcpAgent::from_str 切分。只送可执行文件名，等于把参数丢在半路。
   *
   * 哪家 agent、哪几个参数，由 registry 的档案说了算，这一层不认识任何一家。
   */
  readonly command?: string
  /** The working directory the session is created against. */
  readonly cwd?: string
}

/** 一条对话读回来的一段，以及它一共有多少轮。 */
export interface AgentThreadWindow {
  /** 窗口内的帧，按发生顺序。 */
  readonly events: readonly unknown[]
  /** 这条对话一共有多少轮；窗口外面还有没有，看它。 */
  readonly totalRuns: number
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
  readonly loadThread: (threadId: string, recentRuns?: number) => Promise<AgentThreadWindow>
}

/**
 * Subscribes to run frames.
 *
 * Unsubscribing has to be synchronous for the port, while Tauri's listener
 * registration is asynchronous, so a handle that arrives after the caller has
 * already given up is torn down immediately instead of leaking.
 */
export function createAgentEventSource({
  onListenFailure,
}: AgentEventSourceOptions = {}): AgentEventSource {
  return {
    listen: (handler) => {
      let cancelled = false
      let stop: (() => void) | null = null

      void import('@tauri-apps/api/event')
        .then((module) =>
          module.listen<AgentEventEnvelope>(AGENT_EVENT, (event) => {
            // The frame is the contract; the envelope is not.
            handler(event.payload.frame)
          }),
        )
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
    },
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

/**
 * The command half of the port.
 *
 * Cancellation ignores the run identifier because a session runs one turn at a
 * time, so there is exactly one turn to stop. Answering a permission request
 * is checked natively: an answer naming an option the agent never offered is
 * refused rather than acted on.
 */
export function createAgentCommandBridge({
  agentId,
  command,
  cwd,
}: AgentBridgeOptions = {}): AgentCommandBridge {
  return {
    prompt: async (request) => {
      const result = await call(() =>
        commands.agentPrompt({
          text: request.text,
          threadId: request.threadId ?? null,
          agentId: agentId ?? null,
          command: command ?? null,
          cwd: cwd ?? null,
        }),
      )

      return { runId: result.runId, sessionId: result.sessionId }
    },

    cancel: async (_runId) => {
      await call(() => commands.agentCancel())
    },

    resolvePermission: async (requestId, optionId) => {
      await call(() => commands.agentResolvePermission({ requestId, optionId }))
    },

    loadRun: async (runId) => {
      const snapshot = await call(() => commands.agentLoadRun({ runId, afterSeq: null }))

      return snapshot.events
    },

    loadThread: async (threadId, recentRuns) => {
      const transcript = await call(() =>
        commands.agentLoadThread({ threadId, recentRuns: recentRuns ?? null }),
      )

      return { events: transcript.events, totalRuns: transcript.totalRuns }
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

/** What a selector is for, as far as the interface is concerned. */
export type AgentConfigPurposeName = 'mode' | 'model' | 'other' | 'thought'

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

export interface AgentSessionConfigBridge {
  readonly select: (
    threadId: string | null,
    configId: string,
    value: string,
  ) => Promise<readonly AgentConfigControlDescription[]>
}

interface NativeChoice {
  readonly value: string
  readonly label: string
  readonly detail: string | null
}

interface NativeControl {
  readonly id: string
  readonly label: string
  readonly detail: string | null
  readonly purpose: string
  readonly current: string
  readonly choices: readonly NativeChoice[]
}

/**
 * Names the purpose without trusting this build to know every category.
 *
 * A category nobody here has heard of is carried as other rather than
 * dropped: the protocol allows one, and the user should still be able to
 * change it.
 */
function purposeOf(value: string): AgentConfigPurposeName {
  /*
   * Case is a serialisation detail, not a decision the interface should
   * be at the mercy of. A category the native side spells with a capital
   * would otherwise land in other, and every row would be filed under a
   * heading none of them belongs to.
   */
  const named = value.toLowerCase()

  if (named === 'model' || named === 'thought' || named === 'mode') {
    return named
  }

  return 'other'
}

/*
 * The wire says null for absent and the port says absent, which under
 * exactOptionalPropertyTypes are different types, so the key is left out.
 */
function choiceOf(native: NativeChoice): AgentConfigChoiceDescription {
  return {
    value: native.value,
    label: native.label,
    ...(native.detail === null ? {} : { detail: native.detail }),
  }
}

function controlOf(native: NativeControl): AgentConfigControlDescription {
  return {
    id: native.id,
    label: native.label,
    purpose: purposeOf(native.purpose),
    current: native.current,
    choices: native.choices.map(choiceOf),
    ...(native.detail === null ? {} : { detail: native.detail }),
  }
}

export function createAgentSessionConfigBridge(): AgentSessionConfigBridge {
  return {
    select: async (threadId, configId, value) => {
      const offered = await call(() => commands.agentSetConfigOption({ threadId, configId, value }))

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

/** One conversation as the native side reports it. */
export interface AgentThreadDescription {
  readonly threadId: string
  readonly sessionId: string | null
  readonly title: string
  /** official, manual, message or fallback, as recorded. */
  readonly titleSource: string
  readonly updatedAt: string
  /** Whether it is held at the top of the list. */
  readonly pinned: boolean
}

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

export function createAgentThreadBridge({
  agentId,
  command,
  cwd,
}: AgentBridgeOptions = {}): AgentThreadBridge {
  return {
    list: () => call(() => commands.agentThreads()),

    open: async (threadId) => {
      const opened = await call(() =>
        commands.agentOpenThread({
          threadId: threadId ?? null,
          agentId: agentId ?? null,
          command: command ?? null,
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
