import type {
  AgentPromptHandle,
  AgentPromptRequest,
  AgentSessionPort,
  RunEvent,
  RunId,
} from '@poietica/agent-protocol'

/**
 * A session port backed by the Rust runtime.
 *
 * The bridge is injected rather than imported: the feature layer declares the
 * port it needs and the platform layer supplies it, so nothing here depends on
 * a desktop runtime and the whole adapter is unit-testable.
 *
 * 帧不在这里重新校验一遍。
 *
 * 不可信的那一侧是 agent 子进程与原生运行时之间，而那里已经由官方 SDK 的类型
 * 反序列化把关：畸形帧到不了 recorder。到这里的每一帧都出自 frame.rs 里那个
 * 强类型 enum，形状由 Rust 编译期保证。对自己进程的输出再写一份运行期 schema，
 * 换不到安全，只换来第三份要同步的协议描述 —— 以及一个真实的故障模式：一个
 * 封闭形状的校验器遇到协议新增的字段就会把整轮判成「无法解析」，而回放历史时
 * 那些帧会被静默丢弃。
 *
 * 所以这一层只做一件事：把线上的值断言成端口契约，一次，在这里。
 */

export interface AgentEventSource {
  /** Hands out the frame and the run it belongs to; the frames carry no address. */
  readonly listen: (handler: (payload: unknown, runId: RunId) => void) => () => void
}

export interface AgentCommandBridge {
  readonly prompt: (
    request: AgentPromptRequest,
  ) => Promise<{ readonly runId: RunId; readonly sessionId: string }>
  readonly cancel: (runId: RunId) => Promise<void>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
  readonly loadRun: (runId: RunId) => Promise<readonly unknown[]>
  readonly loadThread: (threadId: string) => Promise<readonly unknown[]>
}

export interface IpcSessionOptions {
  readonly bridge: AgentCommandBridge
  readonly source: AgentEventSource
}

export function createIpcSession({ bridge, source }: IpcSessionOptions): AgentSessionPort {
  return {
    subscribe: (listener) =>
      source.listen((payload, runId) => {
        listener(payload as RunEvent, runId)
      }),

    prompt: async (request): Promise<AgentPromptHandle> => {
      const { runId, sessionId } = await bridge.prompt(request)

      return { runId, sessionId, cancel: () => bridge.cancel(runId) }
    },

    resolvePermission: (requestId, optionId) => bridge.resolvePermission(requestId, optionId),

    loadRun: async (runId) => (await bridge.loadRun(runId)) as readonly RunEvent[],

    loadThread: async (threadId) => (await bridge.loadThread(threadId)) as readonly RunEvent[],
  }
}
