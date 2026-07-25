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
  /** The agent command line; the native side defaults to the Kimi ACP entry point. */
  readonly command?: string
  /** The working directory the session is created against. */
  readonly cwd?: string
}

export interface AgentCommandBridge {
  readonly prompt: (request: {
    readonly text: string
  }) => Promise<{ readonly runId: string; readonly sessionId: string }>
  readonly cancel: (runId: string) => Promise<void>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
  readonly loadRun: (runId: string) => Promise<readonly unknown[]>
}

const NOT_IMPLEMENTED =
  'answering a permission request is not wired up yet: the native handler still refuses automatically'

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
 * Two limits are deliberate and visible rather than papered over. Cancellation
 * ignores the run identifier because a session runs one turn at a time, so
 * there is exactly one turn to stop. Answering a permission request throws,
 * because the native handler cannot yet wait for an answer and a silently
 * successful call would be a lie the interface would act on.
 */
export function createAgentCommandBridge({
  command,
  cwd,
}: AgentBridgeOptions = {}): AgentCommandBridge {
  return {
    prompt: async (request) => {
      const result = await call(() =>
        commands.agentPrompt({
          text: request.text,
          command: command ?? null,
          cwd: cwd ?? null,
        }),
      )

      return { runId: result.runId, sessionId: result.sessionId }
    },

    cancel: async (_runId) => {
      await call(() => commands.agentCancel())
    },

    resolvePermission: (_requestId, _optionId) => Promise.reject(new Error(NOT_IMPLEMENTED)),

    loadRun: async (runId) => {
      const snapshot = await call(() => commands.agentLoadRun({ runId, afterSeq: null }))

      return snapshot.events
    },
  }
}

/** Ends the session and lets the agent process exit. */
export async function shutdownAgent(): Promise<void> {
  await call(() => commands.agentShutdown())
}
