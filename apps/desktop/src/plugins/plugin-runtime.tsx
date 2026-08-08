import type { McpServerWire } from '@poietica/plugins'
import { createPluginStore } from '@poietica/plugins'
import { useEffect } from 'react'

/*
 * 应用层只做两件事：把市场地址与时钟交进去，然后在挂载时开表。
 *
 * 上游用 KIMI_CODE_PLUGIN_MARKETPLACE_URL 覆盖这个地址；这里先钉死官方目录，
 * 等「添加插件市场」那个对话框落地时它会变成一份可增删的清单。
 */

const MARKETPLACE_URL =
  'https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/plugins/marketplace.json'

export const pluginStore = createPluginStore({
  marketplaceUrl: MARKETPLACE_URL,
  now: () => new Date().toISOString(),
})

export function PluginLoader() {
  useEffect(() => pluginStore.start(), [])

  return null
}

/*
 * 这一刻真的会生效的那几台 MCP 服务器。
 *
 * 会话读的就是这一档（见 @poietica/plugins 的 contribution.ts）。它是一次求值,
 * 不是一个值：桥在启动时就建好，而插件随时会被装上、拨掉或卸载 —— 捕获建桥那
 * 一刻的答案，等于把第一帧的猜测钉死一整个进程。与 launch 和 cwd 同一条规矩。
 *
 * 传输认不出的那几台在这里落地（wire 是 undefined）：诊断已经在解析那一层记过,
 * 这里不重复报，也不假装能送。
 */
export function activeMcpServers(): readonly McpServerWire[] {
  const { contributions } = pluginStore.getSnapshot()

  return contributions.mcpServers.flatMap((server) =>
    server.active && server.wire !== undefined ? [server.wire] : [],
  )
}
