import type { SessionConfigControl } from './session-config-contract'

/*
 * 这个 agent 提供哪些可调项：模型、模式、推理档位，一张表。
 *
 * 这个端口不认识 threadId —— 不是省略，是它问不出那种问题。能力属于 agent，
 * 当前生效值才属于某一条会话（见 SessionConfigPort）。入口那一格既没有对话也
 * 没有会话，而选择器在那里必须画得出来：ChatGPT / Claude / Cursor / VS Code
 * Copilot Chat 的新会话界面模型与模式选择器一直都在。
 *
 * 它交出来的 current 只是这一家 agent 的默认值。人选中什么由 capability store
 * 保管，某条会话此刻真在用什么由 ThreadsStore 保管 —— 三件事生命周期不同。
 */

export interface AgentCapabilityPort {
  /** 这个 agent 提供的整张选择器表。 */
  readonly read: () => Promise<readonly SessionConfigControl[]>
}
