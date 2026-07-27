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
    /** The conversation the turn belongs to, where the interface named one. */
    readonly threadId?: string
  }) => Promise<{ readonly runId: string; readonly sessionId: string }>
  readonly cancel: (runId: string) => Promise<void>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
  readonly loadRun: (runId: string) => Promise<readonly unknown[]>
  readonly loadThread: (threadId: string) => Promise<readonly unknown[]>
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
  command,
  cwd,
}: AgentBridgeOptions = {}): AgentCommandBridge {
  return {
    prompt: async (request) => {
      const result = await call(() =>
        commands.agentPrompt({
          text: request.text,
          threadId: request.threadId ?? null,
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

    loadThread: async (threadId) => {
      const transcript = await call(() => commands.agentLoadThread({ threadId }))

      return transcript.events
    },
  }
}

/*
 * The model list is a file, reached through two ordinary commands.
 *
 * Nothing is cached and nothing is merged here: the native side reads the
 * agent's own configuration file, and a switch answers with the state that
 * file is in afterwards.
 */

/** One model the agent's configuration declares. */
export interface AgentModelDescription {
  readonly id: string
  readonly label: string
  readonly provider?: string
}

export interface AgentModelListing {
  readonly models: readonly AgentModelDescription[]
  readonly activeModelId?: string
}

export interface AgentModelBridge {
  readonly list: () => Promise<AgentModelListing>
  readonly select: (modelId: string) => Promise<AgentModelListing>
}

interface NativeModel {
  readonly id: string
  readonly label: string
  readonly provider: string | null
}

interface NativeModelList {
  readonly models: readonly NativeModel[]
  readonly active: string | null
}

/**
 * Turns the native answer into the shape the port declares.
 *
 * The wire says null for absent and the port says absent, which under
 * exactOptionalPropertyTypes are different types, so the key is left out
 * rather than set to undefined.
 */
function listing(result: NativeModelList): AgentModelListing {
  return {
    models: result.models.map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.provider === null ? {} : { provider: model.provider }),
    })),
    ...(result.active === null ? {} : { activeModelId: result.active }),
  }
}

export function createAgentModelBridge(): AgentModelBridge {
  return {
    list: async () => listing(await call(() => commands.agentModels())),

    select: async (modelId) => listing(await call(() => commands.agentSelectModel({ modelId }))),
  }
}

/** Ends the session and lets the agent process exit. */
export async function shutdownAgent(): Promise<void> {
  await call(() => commands.agentShutdown())
}

/*
 * The selectors the live session offers, reached through two commands.
 *
 * Nothing the protocol defines is redefined here. The categories are the
 * agent, and an empty list means no session has been created yet rather
 * than an agent with nothing to offer.
 */

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

export interface AgentConfigBridge {
  readonly list: () => Promise<readonly AgentConfigControlDescription[]>
  readonly select: (
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

export function createAgentConfigBridge(): AgentConfigBridge {
  return {
    list: async () => {
      const offered = await call(() => commands.agentConfigOptions())

      return offered.map(controlOf)
    },

    select: async (configId, value) => {
      const offered = await call(() => commands.agentSetConfigOption({ configId, value }))

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
  /** official, message or fallback, as recorded. */
  readonly titleSource: string
  readonly updatedAt: string
}

export interface AgentOpenedThreadDescription {
  readonly thread: AgentThreadDescription
  readonly selectors: readonly AgentConfigControlDescription[]
}

export interface AgentThreadBridge {
  readonly list: () => Promise<readonly AgentThreadDescription[]>
  readonly open: () => Promise<AgentOpenedThreadDescription>
}

function threadOf(native: AgentThreadDescription): AgentThreadDescription {
  return {
    threadId: native.threadId,
    sessionId: native.sessionId,
    title: native.title,
    titleSource: native.titleSource,
    updatedAt: native.updatedAt,
  }
}

export function createAgentThreadBridge({
  command,
  cwd,
}: AgentBridgeOptions = {}): AgentThreadBridge {
  return {
    list: async () => {
      const found = await call(() => commands.agentThreads())

      return found.map(threadOf)
    },

    open: async () => {
      const opened = await call(() =>
        commands.agentOpenThread({ command: command ?? null, cwd: cwd ?? null }),
      )

      return {
        thread: threadOf(opened.thread),
        selectors: opened.selectors.map(controlOf),
      }
    },
  }
}
