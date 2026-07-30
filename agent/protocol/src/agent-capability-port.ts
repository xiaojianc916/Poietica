import type { SessionConfigControl } from './session-config-contract'

/*
 * 「有哪些模型可选」属于这个 agent，不属于任何一条会话。
 *
 * 所以这个端口不认识 threadId —— 不是省略，是它问不出那种问题。选择器曾经只有
 * 一个到达口（ThreadPort.open(threadId)）：必须先有一条对话、先起进程握两趟手，
 * 才知道有哪些模型。入口界面既没有对话也没有会话，于是在结构上不可能画出模型
 * 选择器，渲染层只能拿上一次学到的表去缓存 —— 那是替一条不存在的取数路径打掩护。
 *
 * 当前生效值仍然属于那一条会话（见 SessionConfigPort）。两者生命周期不同，
 * 所以是两个端口，而不是一个端口上的两个参数。
 *
 * 行业对照：ACP 把能力放在 initialize 阶段的握手里，只有当前选中值是 per-session；
 * ChatGPT / Claude / Cursor / VS Code Copilot Chat 的新会话界面模型选择器一直在。
 */

export interface AgentCapabilityPort {
  /** 这个 agent 提供哪些选择器。当前值是它自己报的默认值。 */
  readonly read: () => Promise<readonly SessionConfigControl[]>
}
