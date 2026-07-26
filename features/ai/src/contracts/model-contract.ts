/*
 * A model, as the agent config describes it.
 *
 * The protocol we speak has no model API at all: the pinned ACP surface
 * carries sessions, prompts, permissions and MCP servers, and nothing about
 * which weights answer. That choice lives in the config the agent reads at
 * startup, so a model is a named entry in that file rather than a protocol
 * object, and this interface owns none of it — it displays it and asks for a
 * change.
 */

export interface AgentModel {
  /** Key of the entry in the agent config. */
  readonly id: string
  /** What the person reading it should see. */
  readonly label: string
  /** Provider name as the config spells it, used to pick the mark. */
  readonly provider?: string
}
