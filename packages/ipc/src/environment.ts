import { throughIpc } from './error'
import type { EnvironmentFile } from './generated/ipc-bindings'
import { commands } from './generated/ipc-bindings'

/*
 * 这台机器上已经有的东西。只读 —— 原生侧没有对应的写命令，这一层因此也造不出一个。
 */
export type { EnvironmentFile } from './generated/ipc-bindings'

export function readEnvironmentMcpConfig(): Promise<EnvironmentFile> {
  return throughIpc(() => commands.environmentMcpConfig())
}
