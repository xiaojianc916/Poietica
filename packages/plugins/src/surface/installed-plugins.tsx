import { Button, Switch } from '@poietica/ui'
import { useState } from 'react'

import { describeInstallSource, type PluginTrustTier } from '../install-source'
import type { InstalledPlugin } from '../installation'
import { latestCatalog, type MarketplaceState } from '../marketplace'
import type { InstallFlow, PluginStore } from '../plugin-store'

/**
 * 「插件」那一格：上半是装着的，下半是市场目录里的。
 *
 * 图一原本就是一张滚动页 —— 已装图标一行，底下是可以装的那些。拆成两个 tab 会让
 * 「我装了没有」和「我能装什么」变成两次导航，而人在这一屏想回答的正是这一个问题。
 */

const TRUST_LABEL: Record<PluginTrustTier, string> = {
  'kimi-official': '官方',
  curated: '精选',
  'third-party': '第三方',
}

export interface InstalledPluginsProps {
  readonly plugins: readonly InstalledPlugin[]
  readonly marketplace: MarketplaceState
  readonly install: InstallFlow
  readonly loaded: boolean
  readonly store: PluginStore
}

export function InstalledPlugins({
  plugins,
  marketplace,
  install,
  loaded,
  store,
}: InstalledPluginsProps) {
  const [specifier, setSpecifier] = useState('')
  const catalog = latestCatalog(marketplace)
  const installedIds = new Set(plugins.map((plugin) => plugin.manifest.name))

  return (
    <div className="px-8 pb-10">
      <form
        className="flex gap-2 border-b border-divider py-4"
        onSubmit={(event) => {
          event.preventDefault()

          if (specifier.trim() !== '') {
            store.beginInstall(specifier.trim())
            setSpecifier('')
          }
        }}
      >
        <input
          aria-label="插件来源"
          className="flex-1 rounded-md bg-muted px-3 py-1.5 text-xs outline-none"
          onChange={(event) => {
            setSpecifier(event.target.value)
          }}
          placeholder="本地目录、.zip 直链，或 github.com/owner/repo/tree/main"
          value={specifier}
        />

        <Button size="xs" type="submit" variant="soft">
          添加
        </Button>
      </form>

      <InstallBanner install={install} store={store} />

      {loaded && plugins.length === 0 ? (
        <p className="py-10 text-xs text-muted-foreground">还没有装任何插件。</p>
      ) : null}

      <ul>
        {plugins.map((plugin) => (
          <li
            className="flex items-center gap-4 border-b border-divider py-3"
            key={plugin.manifest.name}
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{plugin.manifest.displayName}</span>

                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                  {TRUST_LABEL[plugin.trust]}
                </span>
              </p>

              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {plugin.manifest.description ?? describeInstallSource(plugin.source)}
              </p>

              {plugin.diagnostics.map((diagnostic) => (
                <p className="mt-1 text-xs text-destructive" key={diagnostic.detail}>
                  {diagnostic.detail}
                </p>
              ))}
            </div>

            <Switch
              aria-label={`启用 ${plugin.manifest.displayName}`}
              checked={plugin.enabled}
              onCheckedChange={(checked) => {
                store.setEnabled(plugin.manifest.name, checked)
              }}
              size="sm"
            />

            <Button
              onClick={() => {
                store.remove(plugin.manifest.name)
              }}
              size="xs"
              type="button"
              variant="ghost"
            >
              移除
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex items-center justify-between border-b border-divider pb-3">
        <h2 className="text-xs font-medium text-muted-foreground">市场目录</h2>

        <Button onClick={store.refreshMarketplace} size="xs" type="button" variant="soft">
          {marketplace.kind === 'fetching' ? '正在刷新…' : '刷新'}
        </Button>
      </div>

      {marketplace.kind === 'failed' ? (
        <p className="py-2 text-xs text-destructive">{marketplace.reason}</p>
      ) : null}

      <ul>
        {(catalog?.entries ?? []).map((entry) => (
          <li className="flex items-center gap-4 border-b border-divider py-3" key={entry.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{entry.displayName}</p>

              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {describeInstallSource(entry.source)}
              </p>
            </div>

            <Button
              disabled={installedIds.has(entry.id)}
              onClick={() => {
                store.beginInstall(describeInstallSource(entry.source))
              }}
              size="xs"
              type="button"
              variant="soft"
            >
              {installedIds.has(entry.id) ? '已安装' : '安装'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/*
 * 确认这一步显示的是解码之后的清单：人看见的是「要装的到底是什么」，不是一句
 * 「确定要安装吗」。不点就一直停在这里，什么也没进 plugins/ —— 默认落在不动上。
 */
function InstallBanner({
  install,
  store,
}: {
  readonly install: InstallFlow
  readonly store: PluginStore
}) {
  if (install.kind === 'idle') {
    return null
  }

  if (install.kind === 'staging') {
    return <p className="py-3 text-xs text-muted-foreground">正在取 {install.specifier}…</p>
  }

  if (install.kind === 'refused') {
    return (
      <div className="flex items-center justify-between py-3">
        <p className="text-xs text-destructive">{install.reason}</p>

        <Button onClick={store.cancelInstall} size="xs" type="button" variant="ghost">
          知道了
        </Button>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-lg border border-divider bg-background px-4 py-3">
      <p className="text-sm font-medium">{install.manifest.displayName}</p>

      <p className="mt-1 text-xs text-muted-foreground">
        {install.manifest.skills.length} 个技能 · {install.manifest.commands.length} 条命令 ·{' '}
        {install.manifest.mcpServers.length} 台 MCP 服务器 · 来自{' '}
        {install.manifest.developerName ?? install.specifier}
      </p>

      {install.diagnostics.map((diagnostic) => (
        <p className="mt-1 text-xs text-destructive" key={diagnostic.detail}>
          {diagnostic.detail}
        </p>
      ))}

      <div className="mt-3 flex gap-2">
        <Button onClick={store.confirmInstall} size="xs" type="button">
          安装
        </Button>

        <Button onClick={store.cancelInstall} size="xs" type="button" variant="ghost">
          取消
        </Button>
      </div>
    </div>
  )
}
