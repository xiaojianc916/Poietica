import type { PluginInstallSource, PluginTrustTier } from './install-source'
import type { PluginDiagnostic, PluginManifest } from './manifest'

/*
 * 一个装好的插件。这是「装了什么、开没开」的唯一真相，界面与会话都读它，没有
 * 第二份副本。
 *
 * systemPromptText 是物化之后的正文：清单说的是提示词在哪（inline 还是一条路径），
 * 预算算的是它有多少字节 —— 算不了一条还没读的路径。读文件是原生侧的事，读完
 * 落在这里，领域层因此不需要碰文件系统。
 */
export interface InstalledPlugin {
  readonly manifest: PluginManifest
  readonly source: PluginInstallSource
  readonly trust: PluginTrustTier
  readonly enabled: boolean
  /* ISO-8601，由调用方给。领域层不摸时钟，否则同一批输入两次跑出两种结果。 */
  readonly installedAt: string
  readonly systemPromptText: string | undefined
  /* 插件整体启用、但被单独关掉的那几台 MCP 服务器。 */
  readonly disabledMcpServers: readonly string[]
  readonly diagnostics: readonly PluginDiagnostic[]
}

/*
 * 解析顺序：安装时间升序，同刻按名字升序。
 *
 * 预算耗尽时被丢掉的是后来者，所以这个顺序必须是全序且稳定 —— 否则同一批插件
 * 两次启动会得到两套不同的提示词。
 */
export function resolutionOrder(plugins: readonly InstalledPlugin[]): readonly InstalledPlugin[] {
  return [...plugins].sort((left, right) => {
    if (left.installedAt !== right.installedAt) {
      return left.installedAt < right.installedAt ? -1 : 1
    }

    if (left.manifest.name === right.manifest.name) {
      return 0
    }

    return left.manifest.name < right.manifest.name ? -1 : 1
  })
}
