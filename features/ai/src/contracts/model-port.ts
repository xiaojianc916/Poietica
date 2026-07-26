import type { AgentModel } from './model-contract'

/*
 * Where the model list comes from, as far as this feature is concerned.
 *
 * Not part of the session port: a model is not a turn, and the pinned ACP
 * surface has no request for one. The implementation reads the file the agent
 * itself reads, which is why selecting returns a list rather than nothing --
 * the answer is the new state of that file, not a guess made here.
 */

export interface AgentModelSelection {
  readonly models: readonly AgentModel[]
  /** Absent until the file names one. */
  readonly activeModelId?: string
}

export interface AgentModelsPort {
  readonly list: () => Promise<AgentModelSelection>
  readonly select: (modelId: string) => Promise<AgentModelSelection>
}
