import { throughIpc } from './error'
import type { EnvironmentFile } from './generated/ipc-bindings'
import { commands } from './generated/ipc-bindings'

export type { EnvironmentFile } from './generated/ipc-bindings'

/*
 * 这个 agent 自己那份 mcp.json —— 只读。
 *
 * 路径由原生侧算，渲染层不拼也不该知道它长什么样：受控 home 生效时它在数据根之下，
 * 不受控时在用户自己的 home 里，而这个判断的唯一产地是 profile.rs。
 */
export function readEnvironmentMcpConfig(): Promise<EnvironmentFile> {
  return throughIpc(() => commands.environmentMcpConfig())
}
