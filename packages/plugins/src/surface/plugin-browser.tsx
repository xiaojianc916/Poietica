import { Button, Switch } from '@poietica/ui'
import { useState } from 'react'

import {
  describeInstallSource,
  type PluginInstallSource,
  type PluginTrustTier,
  parseInstallSource,
} from '../install-source'
import type { InstalledPlugin } from '../installation'
import { latestCatalog, type MarketplaceEntry, type MarketplaceState } from '../marketplace'
import type { InstallFlow, PluginStore } from '../plugin-store'

/**
 * 「插件」那一格：上半是装着的，下半是目录里可以装的。
 *
 * 参考图原本就是一张滚动页 —— 已装在上，能装的在下。拆成两个 tab 会让「我装了
 * 没有」和「我能装什么」变成两次导航，而人在这一屏想回答的正是这一个问题。
 */

const TRUST_LABEL: Record<PluginTrustTier, string> = {
  'kimi-official': '官方',
  curated: '精选',
  'third-party': '第三方',
}

/*
 * 目录里没有图标资源，而一排灰方块认不出谁是谁。用名字派生一个稳定色相：同一个
 * 插件每次都是同一个颜色，这就够人建立「那个蓝的是它」的记忆了。
 */
function hueOf(value: string): number {
  let hash = 7

  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 360
  }

  return hash
}

function PluginGlyph({ name, size }: { readonly name: string; readonly size: 'sm' | 'md' }) {
  const hue = hueOf(name)

  return (
    <span
      aria-hidden="true"
      className={
        size === 'md'
          ? 'flex size-10 shrink-0 items-center justify-center rounded-[10px] text-base font-semibold'
          : 'flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold'
      }
      style={{
        backgroundColor: `oklch(0.93 0.05 ${hue})`,
        color: `oklch(0.45 0.14 ${hue})`,
      }}
    >
      {[...name][0]?.toUpperCase() ?? '?'}
    </span>
  )
}

function capabilitySummary(plugin: InstalledPlugin): string {
  const { skills, commands, agents, mcpServers } = plugin.manifest

  const parts = [
    skills.length > 0 ? `${skills.length} 技能` : undefined,
    commands.length > 0 ? `${commands.length} 命令` : undefined,
    agents.length > 0 ? `${agents.length} 代理` : undefined,
    mcpServers.length > 0 ? `${mcpServers.length} MCP` : undefined,
  ].filter((part) => part !== undefined)

  return parts.length === 0 ? '没有带来可调用的能力' : parts.join(' · ')
}

function matches(needle: string, ...fields: readonly (string | undefined)[]): boolean {
  return needle === '' || fields.join(' ').toLowerCase().includes(needle)
}

export interface PluginBrowserProps {
  readonly plugins: readonly InstalledPlugin[]
  readonly marketplace: MarketplaceState
  readonly install: InstallFlow
  readonly loaded: boolean
  readonly needle: string
  readonly store: PluginStore
}

export function PluginBrowser({
  plugins,
  marketplace,
  install,
  loaded,
  needle,
  store,
}: PluginBrowserProps) {
  const catalog = latestCatalog(marketplace)
  const installedIds = new Set(plugins.map((plugin) => plugin.manifest.name))

  const visible = plugins.filter((plugin) =>
    matches(needle, plugin.manifest.displayName, plugin.manifest.description, plugin.manifest.name),
  )

  const listed = (catalog?.entries ?? []).filter(
    (entry) => !installedIds.has(entry.id) && matches(needle, entry.displayName, entry.description),
  )

  const featured = listed.filter((entry) => entry.trust !== 'third-party')
  const rest = listed.filter((entry) => entry.trust === 'third-party')

  return (
    <div className="space-y-10">
      <AddPluginForm store={store} />

      <InstallBanner install={install} store={store} />

      {loaded && plugins.length === 0 ? null : (
        <Section title="已安装">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有匹配的插件。</p>
          ) : (
            <ul className="divide-y divide-divider">
              {visible.map((plugin) => (
                <li className="flex items-center gap-3 py-3" key={plugin.manifest.name}>
                  <PluginGlyph name={plugin.manifest.displayName} size="sm" />

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{plugin.manifest.displayName}</span>

                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                        {TRUST_LABEL[plugin.trust]}
                      </span>
                    </p>

                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {plugin.manifest.description ?? capabilitySummary(plugin)}
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
          )}
        </Section>
      )}

      {marketplace.kind === 'failed' ? (
        <p className="rounded-lg border border-divider bg-background px-4 py-3 text-xs text-destructive">
          市场目录刷新失败：{marketplace.reason}
        </p>
      ) : null}

      {featured.length > 0 ? (
        <Section title="精选">
          <CatalogGrid entries={featured} store={store} />
        </Section>
      ) : null}

      {rest.length > 0 ? (
        <Section title="更多插件">
          <CatalogGrid entries={rest} store={store} />
        </Section>
      ) : null}

      {catalog === undefined && marketplace.kind !== 'fetching' ? (
        <p className="text-sm text-muted-foreground">还没有取到市场目录。按右上角的刷新拉一次。</p>
      ) : null}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>

      {children}
    </section>
  )
}

function CatalogGrid({
  entries,
  store,
}: {
  readonly entries: readonly MarketplaceEntry[]
  readonly store: PluginStore
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entries.map((entry) => (
        <article
          className="flex items-start gap-3 rounded-xl border border-divider bg-background p-4 transition-colors hover:border-foreground/20"
          key={entry.id}
        >
          <PluginGlyph name={entry.displayName} size="md" />

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{entry.displayName}</p>

            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {entry.description ?? describeInstallSource(entry.source)}
            </p>
          </div>

          <Button
            onClick={() => {
              store.beginInstall(entry.source)
            }}
            size="xs"
            type="button"
            variant="soft"
          >
            安装
          </Button>
        </article>
      ))}
    </div>
  )
}

function AddPluginForm({ store }: { readonly store: PluginStore }) {
  const [specifier, setSpecifier] = useState('')

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()

        const trimmed = specifier.trim()

        if (trimmed !== '') {
          store.beginInstall(parseInstallSource(trimmed))
          setSpecifier('')
        }
      }}
    >
      <input
        aria-label="插件来源"
        className="flex-1 rounded-lg border border-divider bg-background px-3.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/25"
        onChange={(event) => {
          setSpecifier(event.target.value)
        }}
        placeholder="本地目录、.zip 直链，或 github.com/owner/repo/tree/main"
        value={specifier}
      />

      <Button size="sm" type="submit" variant="soft">
        添加
      </Button>
    </form>
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
    return (
      <p className="text-sm text-muted-foreground">
        正在取 {describeInstallSource(install.source)}…
      </p>
    )
  }

  if (install.kind === 'refused') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-divider bg-background px-4 py-3">
        <p className="text-xs text-destructive">{install.reason}</p>

        <Button onClick={store.cancelInstall} size="xs" type="button" variant="ghost">
          知道了
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-divider bg-background p-4">
      <div className="flex items-start gap-3">
        <PluginGlyph name={install.manifest.displayName} size="md" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{install.manifest.displayName}</p>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {install.manifest.skills.length} 技能 · {install.manifest.commands.length} 命令 ·{' '}
            {install.manifest.mcpServers.length} MCP · 来自{' '}
            {install.manifest.developerName ?? describeInstallSource(install.source)}
          </p>
        </div>

        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {TRUST_LABEL[install.trust]}
        </span>
      </div>

      {install.diagnostics.map((diagnostic) => (
        <p className="mt-2 text-xs text-destructive" key={diagnostic.detail}>
          {diagnostic.detail}
        </p>
      ))}

      <div className="mt-4 flex gap-2">
        <Button onClick={store.confirmInstall} size="xs" type="button">
          安装插件
        </Button>

        <Button onClick={store.cancelInstall} size="xs" type="button" variant="ghost">
          取消
        </Button>
      </div>
    </div>
  )
}

export type { PluginInstallSource }
