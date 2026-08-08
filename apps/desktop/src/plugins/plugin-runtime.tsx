import { createPluginStore } from '@poietica/plugins'
import { useEffect } from 'react'

/**
 * 插件状态在这里落地，一个进程一份。
 *
 * 与 automationStore 同一条纪律：它不属于任何一格界面 —— 装着哪些插件决定了会话
 * 看得见什么，所以它必须活到进程结束，而不是跟着 Tool 那一格的挂载与卸载来回读盘。
 */

/*
 * 目录从上游仓库拉。
 *
 * 上游用 KIMI_CODE_PLUGIN_MARKETPLACE_URL 覆盖它；这个应用没有环境变量这条通道，
 * 所以它是一个常量。真要能改，那是设置项，不是又一个读环境变量的地方。
 */
const MARKETPLACE_URL =
  'https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/plugins/marketplace.json'

export const pluginStore = createPluginStore({
  /*
   * 空集，而且这是事实不是占位：内置 sub-agent 住在对面那个 CLI 进程里，ACP 上
   * 没有任何一条消息报得出它们的名字。报得出的那天，从这里交进去。
   */
  reservedAgentNames: new Set(),
  marketplaceUrl: MARKETPLACE_URL,
  now: () => new Date().toISOString(),
})

/** 无渲染产出，只是让插件的装载与应用同寿。 */
export function PluginLoader() {
  useEffect(() => pluginStore.start(), [])

  return null
}
