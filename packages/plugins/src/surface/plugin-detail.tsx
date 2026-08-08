import { Button, Switch } from '@poietica/ui'

import { describeInstallSource, type PluginInstallSource } from '../install-source'
import type { InstalledPlugin } from '../installation'
import type { MarketplaceEntry } from '../marketplace'
import type { PluginStore } from '../plugin-store'
import { PluginGlyph, pluginHue } from './plugin-glyph'
import { TrustBadge } from './trust-badge'

/**
 * 一个插件的详情。
 *
 * 装了的读清单，没装的读目录 —— 同一页两种数据密度，因为事实就是两种：清单在
 * 插件包里，包没下载就没有清单。这里不为了让版面整齐而造一个「技能 0」出来，
 * 没有的就明说下载后才知道。
 */

function ownerOf(source: PluginInstallSource | undefined): string | undefined {
  return source?.kind === 'github' ? source.owner : undefined
}

interface InfoRow {
  readonly label: string
  readonly value: string
}

export interface PluginDetailProps {
  readonly entry: MarketplaceEntry | undefined
  readonly plugin: InstalledPlugin | undefined
  readonly store: PluginStore
  readonly onBack: () => void
}

export function PluginDetail({ entry, plugin, store, onBack }: PluginDetailProps) {
  const manifest = plugin?.manifest
  const id = manifest?.name ?? entry?.id ?? ''
  const displayName = manifest?.displayName ?? entry?.displayName ?? id
  const source = plugin?.source ?? entry?.source
  const trust = plugin?.trust ?? entry?.trust

  const rows: readonly InfoRow[] = [
    { label: '开发者', value: manifest?.developerName ?? ownerOf(source) ?? '未署名' },
    { label: '版本', value: manifest?.version ?? entry?.version ?? '未声明' },
    { label: '分类', value: entry?.keywords.join('、') ?? '未分类' },
    { label: '主页', value: manifest?.homepage ?? entry?.homepage ?? '未提供' },
    { label: '来源', value: source === undefined ? '未知' : describeInstallSource(source) },
  ]

  return (
    <div className="space-y-8">
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <button
          className="rounded px-1 py-0.5 transition-colors hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          插件
        </button>

        <span aria-hidden="true">/</span>

        <span className="text-foreground">{displayName}</span>
      </nav>

      <header className="flex items-start gap-4">
        <PluginGlyph displayName={displayName} id={id} size="lg" />

        <div className="min-w-0 flex-1 pt-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="truncate">{displayName}</span>

            {trust === undefined ? null : <TrustBadge trust={trust} />}
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            {manifest?.description ?? entry?.description ?? '这个插件没有写说明。'}
          </p>
        </div>

        {plugin === undefined ? (
          <Button
            disabled={entry === undefined}
            onClick={() => {
              if (entry !== undefined) {
                store.beginInstall(entry.source)
              }
            }}
            size="sm"
            type="button"
          >
            + 安装插件
          </Button>
        ) : (
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <Switch
              aria-label={`启用 ${displayName}`}
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
          </div>
        )}
      </header>

      {plugin === undefined ? null : <Usage id={id} plugin={plugin} />}

      {plugin === undefined ? (
        <p className="rounded-xl border border-divider bg-background px-4 py-3 text-xs leading-5 text-muted-foreground">
          这个插件带来哪些技能、命令与服务器，要下载之后读它自己的清单才知道 ——
          清单在插件包里。装上之后这里会列出全部内容。
        </p>
      ) : (
        <Capabilities plugin={plugin} store={store} />
      )}

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          信息
        </h3>

        <dl className="divide-y divide-divider overflow-hidden rounded-xl border border-divider">
          {rows.map((row) => (
            <div className="flex gap-6 px-4 py-2.5 text-sm" key={row.label}>
              <dt className="w-16 shrink-0 text-muted-foreground">{row.label}</dt>

              <dd className="min-w-0 flex-1 break-all">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

/*
 * 装上之后怎么用。
 *
 * 列的是真实存在的斜杠命令，不是示例文案 —— 命令名与说明都从清单里来（说明的
 * 回落顺序由 commandDescription 决定）。一个插件带来的命令按 <插件名>:<命令名>
 * 命名空间化，人不看清单不会知道这件事，所以它必须写在这里。
 */
function Usage({ id, plugin }: { readonly id: string; readonly plugin: InstalledPlugin }) {
  const commands = plugin.manifest.commands.slice(0, 3)

  if (commands.length === 0) {
    return null
  }

  const hue = pluginHue(id)

  return (
    <section
      className="rounded-xl border border-divider p-4"
      style={{
        backgroundImage: `linear-gradient(135deg, oklch(0.97 0.03 ${hue}), oklch(0.99 0.008 ${
          (hue + 40) % 360
        }))`,
      }}
    >
      <h3 className="text-xs font-medium text-muted-foreground">在对话里这样用</h3>

      <ul className="mt-3 space-y-2">
        {commands.map((command) => (
          <li className="flex items-center gap-3 text-sm" key={command.name}>
            <code className="rounded bg-background/70 px-1.5 py-0.5 text-xs">
              /{plugin.manifest.name}:{command.name}
            </code>

            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {command.description}
            </span>

            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Capabilities({
  plugin,
  store,
}: {
  readonly plugin: InstalledPlugin
  readonly store: PluginStore
}) {
  const { manifest } = plugin
  const disabled = new Set(plugin.disabledMcpServers)

  return (
    <div className="space-y-6">
      <CapabilitySection items={manifest.skills} title="技能">
        {(skill) => <span className="text-sm">{skill}</span>}
      </CapabilitySection>

      <CapabilitySection items={manifest.commands.map((command) => command.name)} title="命令">
        {(name) => (
          <code className="text-xs">
            /{manifest.name}:{name}
          </code>
        )}
      </CapabilitySection>

      <CapabilitySection items={manifest.agents.map((agent) => agent.name)} title="代理">
        {(name) => <span className="text-sm">{name}</span>}
      </CapabilitySection>

      <CapabilitySection
        items={manifest.mcpServers.map((server) => server.name)}
        title="MCP 服务器"
      >
        {(name) => (
          <span className="flex flex-1 items-center justify-between gap-4">
            <span className="text-sm">{name}</span>

            <Switch
              aria-label={`启用 ${name}`}
              checked={!disabled.has(name)}
              onCheckedChange={(checked) => {
                store.setMcpServerEnabled(manifest.name, name, checked)
              }}
              size="sm"
            />
          </span>
        )}
      </CapabilitySection>
    </div>
  )
}

/* 空的分区整段不画：一排「0」只是在告诉人这里什么都没有，占着版面却不带信息。 */
function CapabilitySection({
  title,
  items,
  children,
}: {
  readonly title: string
  readonly items: readonly string[]
  readonly children: (item: string) => React.ReactNode
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums opacity-60">{items.length}</span>
      </h3>

      <ul className="divide-y divide-divider overflow-hidden rounded-xl border border-divider">
        {items.map((item) => (
          <li className="flex items-center px-4 py-2.5" key={item}>
            {children(item)}
          </li>
        ))}
      </ul>
    </section>
  )
}
