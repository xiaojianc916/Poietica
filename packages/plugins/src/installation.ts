import type { PluginInstallSource, PluginTrustTier } from './install-source'
import type { PluginDiagnostic, PluginManifest } from './manifest'

/*
 * 一个装好的插件 = plugins/ 下一个带清单的目录，外加我们为它记下的偏好。
 *
 * source 与 installedAt 可缺，而且这是事实不是疏漏：目录被人手动放进来时，没有
 * 任何人记录过它从哪来、什么时候来。缺就是缺，不编一个出来。
 *
 * systemPromptText 是物化之后的正文：清单说的是提示词在哪（内联，或一条路径，
 * 或两者依次），预算算的是它有多少字节 —— 算不了一条还没读的路径。读文件是原生
 * 侧的事，读完落在这里，领域层因此不需要碰文件系统。
 */
export interface InstalledPlugin {
  readonly manifest: PluginManifest
  readonly source: PluginInstallSource | undefined
  readonly trust: PluginTrustTier
  readonly enabled: boolean
  /* ISO-8601。装载顺序按它排。 */
  readonly installedAt: string | undefined
  readonly systemPromptText: string | undefined
  /* 插件整体启用、但被单独关掉的那几台 MCP 服务器。 */
  readonly disabledMcpServers: readonly string[]
  readonly diagnostics: readonly PluginDiagnostic[]
}

/*
 * 解析顺序：安装时间升序，同刻按名字升序，时间未知的排在最前。
 *
 * 预算耗尽时被丢掉的是后来者，所以这个顺序必须是全序且稳定 —— 否则同一批插件
 * 两次启动会得到两套不同的提示词。
 */
export function resolutionOrder(plugins: readonly InstalledPlugin[]): readonly InstalledPlugin[] {
  return [...plugins].sort((left, right) => {
    const leftAt = left.installedAt ?? ''
    const rightAt = right.installedAt ?? ''

    if (leftAt !== rightAt) {
      return leftAt < rightAt ? -1 : 1
    }

    if (left.manifest.name === right.manifest.name) {
      return 0
    }

    return left.manifest.name < right.manifest.name ? -1 : 1
  })
}
