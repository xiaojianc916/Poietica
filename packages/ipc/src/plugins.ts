import { throughIpc } from './error'
import type {
  PluginCommitRequest,
  PluginFetch,
  PluginFileRequest,
  PluginFileText,
  PluginPayload,
  PluginStaged,
  PluginTreeRequest,
} from './generated/ipc-bindings'
import { commands } from './generated/ipc-bindings'

/*
 * DTO 一个字都不在这里重新声明：原生侧是契约的产地，这一层只把它转成 Promise 并让
 * 失败走同一条 throughIpc。手写一份对齐的类型就是两份真相。
 */
export type {
  PluginCommitRequest,
  PluginFetch,
  PluginFileRequest,
  PluginFileText,
  PluginPayload,
  PluginStaged,
  PluginTreeRequest,
} from './generated/ipc-bindings'

export function listPlugins(): Promise<PluginPayload[]> {
  return throughIpc(() => commands.pluginsList())
}

export function readPluginText(request: PluginFileRequest): Promise<string> {
  return throughIpc(() => commands.pluginsReadText(request))
}

/* null 表示声明的路径不在盘上；空数组表示路径在，里面没有匹配后缀的文件。 */
export function readPluginTree(request: PluginTreeRequest): Promise<PluginFileText[] | null> {
  return throughIpc(() => commands.pluginsReadTree(request))
}

export function stagePlugin(fetch: PluginFetch): Promise<PluginStaged> {
  return throughIpc(() => commands.pluginsStage(fetch))
}

export function commitPlugin(request: PluginCommitRequest): Promise<void> {
  return throughIpc(async () => {
    await commands.pluginsCommit(request)
  })
}

export function discardStagedPlugin(stagingId: string): Promise<void> {
  return throughIpc(async () => {
    await commands.pluginsDiscard(stagingId)
  })
}

export function removePlugin(pluginId: string): Promise<void> {
  return throughIpc(async () => {
    await commands.pluginsRemove(pluginId)
  })
}

export function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return throughIpc(async () => {
    await commands.pluginsSetEnabled(pluginId, enabled)
  })
}

export function setPluginMcpEnabled(
  pluginId: string,
  server: string,
  enabled: boolean,
): Promise<void> {
  return throughIpc(async () => {
    await commands.pluginsSetMcpEnabled(pluginId, server, enabled)
  })
}

export function readPluginCatalog(): Promise<string | null> {
  return throughIpc(() => commands.pluginsCatalogRead())
}

export function refreshPluginCatalog(url: string): Promise<string> {
  return throughIpc(() => commands.pluginsCatalogRefresh(url))
}
