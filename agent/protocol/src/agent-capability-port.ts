import type { SessionConfigChoice } from './session-config-contract'

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
 * 它也不经过 ACP。握手要 agent 交出一个会话号，而上游在开会话之前先查
 * default_model 可不可用 —— 缺席就拒绝。拿握手去问"有哪些模型"，等于让"看清单"
 * 依赖"已经从清单里选好一个"，而这两件事的先后顺序在一台新机器上是反的。产地
 * 因此是 agent 自己的 CLI：provider list --json 读的就是那份 config.toml，一次
 * 子进程调用，没有会话可言。
 *
 * 返回的是清单本身，不是一张选择器表。id、label、purpose 三格全是这一侧的常量,
 * 让它们绕一趟 agent 再回来，只是给一个我们已经知道的答案编一条取数路径。
 *
 * 行业对照：ChatGPT / Claude / Cursor / VS Code Copilot Chat 的新会话界面模型
 * 选择器一直在，不需要先开一条对话。
 */

export interface AgentCapabilityPort {
  /** 这个 agent 配了哪些模型。别名与显示名，此外什么都不带。 */
  readonly read: () => Promise<readonly SessionConfigChoice[]>
}
