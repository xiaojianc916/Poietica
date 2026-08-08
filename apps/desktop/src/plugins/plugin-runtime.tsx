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
