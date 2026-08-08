import { Button } from '@poietica/ui'
import { useState } from 'react'

import { describeInstallSource, parseInstallSource } from '../install-source'
import type { InstalledPlugin } from '../installation'
import { latestCatalog, type MarketplaceEntry, type MarketplaceState } from '../marketplace'
import type { InstallFlow, PluginStore } from '../plugin-store'
import { PluginGlyph } from './plugin-glyph'
import { TrustBadge } from './trust-badge'

/*
 * 目录页。
 *
 * 「装了什么」不在这里判 —— 传进来的 plugins 就是磁盘上那一份，这里只做减法：
 * 已经在盘上的条目不再出现在下面的目录网格里，而是升到上面那一行「已安装」。
 * 之前这份名单来自账本，账本一解不开就整份为空，于是装过的插件在网格里重新长出
 * 一颗「安装」按钮。
 */

function capabilitySummary(plugin: InstalledPlugin): string {
  const { agentRoots, commandRoots, mcpServers, skillRoots } = plugin.manifest

  const parts = [
    skillRoots.length > 0 ? `技能 ${skillRoots.length} 处` : undefined,
    commandRoots.length > 0 ? `命令 ${commandRoots.length} 处` : undefined,
    agentRoots.length > 0 ? `代理 ${agentRoots.length} 处` : undefined,
    mcpServers.length > 0 ? `MCP ${mcpServers.length} 台` : undefined,
  ].filter((part) => part !== undefined)

  return parts.length === 0 ? '没有带来可调用的能力' : parts.join(' · ')
}

function matches(needle: string, ...fields: readonly (string | undefined)[]): boolean {
  if (needle === '') {
    return true
  }

  const lowered = needle.toLowerCase()

  return fields.some((field) => field !== undefined && field.toLowerCase().includes(lowered))
}

export interface PluginBrowserProps {
  readonly plugins: readonly InstalledPlugin[]
  readonly marketplace: MarketplaceState
  readonly install: InstallFlow
  readonly loaded: boolean
  readonly needle: string
  readonly store: PluginStore
  readonly onOpen: (id: string) => void
}

export function PluginBrowser({
  install,
  loaded,
  marketplace,
  needle,
  onOpen,
  plugins,
  store,
}: PluginBrowserProps) {
  const catalog = latestCatalog(marketplace)
  const installedIds = new Set(plugins.map((plugin) => plugin.manifest.name))
  const listed = (catalog?.entries ?? []).filter(
    (entry) =>
      !installedIds.has(entry.id) &&
      matches(needle, entry.displayName, entry.id, entry.description),
  )
  const installed = plugins.filter((plugin) =>
    matches(needle, plugin.manifest.displayName, plugin.manifest.name, plugin.manifest.description),
  )

  return (
    <div className="pb-20">
      <AddPluginForm store={store} />
      <InstallBanner install={install} store={store} />
      {installed.length > 0 ? (
        <Section title="已安装">
          <ul className="divide-y divide-divider">
            {installed.map((plugin) => (
              <li className="flex items-center gap-3 py-3" key={plugin.manifest.name}>
                <PluginGlyph
                  displayName={plugin.manifest.displayName}
                  id={plugin.manifest.name}
                  size="sm"
                />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpen(plugin.manifest.name)}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {plugin.manifest.displayName}
                    </span>
                    <TrustBadge trust={plugin.trust} />
                    {plugin.enabled ? null : (
                      <span className="text-[11px] text-muted-foreground">已关闭</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {capabilitySummary(plugin)}
                  </span>
                </button>
                <Button
                  onClick={() => store.remove(plugin.manifest.name)}
                  size="xs"
                  variant="ghost"
                >
                  卸载
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <CatalogGrid
        entries={listed.filter((entry) => entry.trust !== 'third-party')}
        onOpen={onOpen}
        title="精选"
      />
      <CatalogGrid
        entries={listed.filter((entry) => entry.trust === 'third-party')}
        onOpen={onOpen}
        title="更多"
      />
      {loaded && installed.length === 0 && listed.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {needle === '' ? '目录还没取到。点右上角刷新试试。' : `没有匹配「${needle}」的插件。`}
        </p>
      ) : null}
    </div>
  )
}

interface SectionProps {
  readonly title: string
  readonly children: React.ReactNode
}

function Section({ children, title }: SectionProps) {
  return (
    <section className="pt-8">
      <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface CatalogGridProps {
  readonly entries: readonly MarketplaceEntry[]
  readonly title: string
  readonly onOpen: (id: string) => void
}

function CatalogGrid({ entries, onOpen, title }: CatalogGridProps) {
  if (entries.length === 0) {
    return null
  }

  return (
    <Section title={title}>
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <article
            className="relative flex gap-3 rounded-xl border border-divider bg-background p-4 transition-colors hover:border-foreground/20"
            key={entry.id}
          >
            <PluginGlyph displayName={entry.displayName} id={entry.id} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  className="truncate text-sm font-medium after:absolute after:inset-0"
                  onClick={() => onOpen(entry.id)}
                  type="button"
                >
                  {entry.displayName}
                </button>
                <TrustBadge trust={entry.trust} />
              </div>
              <p className="line-clamp-2 pt-1 text-xs leading-5 text-muted-foreground">
                {entry.description ?? describeInstallSource(entry.source)}
              </p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  )
}

interface AddPluginFormProps {
  readonly store: PluginStore
}

/*
 * 手动来源那条通道。
 *
 * 输入串到底是本地目录、直链压缩包还是 GitHub 仓库，由 parseInstallSource 一处
 * 判定 —— 界面不认这三种形态，也就不会跟领域层判得不一样。
 */
function AddPluginForm({ store }: AddPluginFormProps) {
  const [text, setText] = useState('')

  return (
    <form
      className="flex gap-2 pt-6"
      onSubmit={(event) => {
        event.preventDefault()

        const specifier = text.trim()

        if (specifier === '') {
          return
        }

        store.beginInstall(parseInstallSource(specifier))
        setText('')
      }}
    >
      <input
        className="h-9 min-w-0 flex-1 rounded-lg border border-divider bg-background px-3 text-sm outline-none focus:border-foreground/25"
        onChange={(event) => setText(event.target.value)}
        placeholder="本地目录、.zip 直链，或 github.com/owner/repo"
        value={text}
      />
      <Button size="sm" type="submit" variant="secondary">
        添加
      </Button>
    </form>
  )
}

interface InstallBannerProps {
  readonly install: InstallFlow
  readonly store: PluginStore
}

function InstallBanner({ install, store }: InstallBannerProps) {
  if (install.kind === 'idle') {
    return null
  }

  if (install.kind === 'staging') {
    return (
      <p className="pt-4 text-xs text-muted-foreground">
        正在取 {describeInstallSource(install.source)}…
      </p>
    )
  }

  if (install.kind === 'refused') {
    return (
      <div className="flex items-center gap-3 pt-4">
        <p className="flex-1 text-xs text-destructive">{install.reason}</p>
        <Button onClick={() => store.cancelInstall()} size="xs" variant="ghost">
          知道了
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-divider bg-background p-4">
      <p className="text-sm font-medium">{install.manifest.displayName}</p>
      <p className="pt-1 text-xs leading-5 text-muted-foreground">
        来自 {describeInstallSource(install.source)}。装上之后它会带来
        {` ${capabilityLine(install.manifest.skillRoots.length, install.manifest.mcpServers.length)}`}
        。
      </p>
      {install.diagnostics.map((diagnostic) => (
        <p className="pt-1 text-xs text-muted-foreground" key={diagnostic.detail}>
          {diagnostic.detail}
        </p>
      ))}
      <div className="flex gap-2 pt-3">
        <Button onClick={() => store.confirmInstall()} size="sm">
          安装
        </Button>
        <Button onClick={() => store.cancelInstall()} size="sm" variant="ghost">
          取消
        </Button>
      </div>
    </div>
  )
}

function capabilityLine(skills: number, servers: number): string {
  const parts = [
    skills > 0 ? `${skills} 处技能` : undefined,
    servers > 0 ? `${servers} 台 MCP 服务器` : undefined,
  ].filter((part) => part !== undefined)

  return parts.length === 0 ? '一段系统提示词' : parts.join(' 与 ')
}
