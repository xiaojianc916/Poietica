import { Button, Switch } from '@poietica/ui'

import { describeInstallSource } from '../install-source'
import type { InstalledPlugin } from '../installation'
import type { MarketplaceEntry } from '../marketplace'
import type { PluginStore } from '../plugin-store'
import { PluginGlyph, pluginHue } from './plugin-glyph'
import { TrustBadge } from './trust-badge'

/*
 * 详情页。
 *
 * 「装上之后会发生什么」这一段只说清单真的声明了的事：会话开始装载哪个技能、命令
 * 从哪个目录来、以什么前缀调用。上一版在这里列了三条形如 /plugin:command 的示例，
 * 那些名字是从一个不存在的清单字段里读的 —— commands 在上游是路径不是命令名，
 * 真正的命令要扫盘才知道。宁可少说一行，不能编一行。
 */

export interface PluginDetailProps {
  readonly entry: MarketplaceEntry | undefined
  readonly plugin: InstalledPlugin | undefined
  readonly store: PluginStore
  readonly onBack: () => void
}

export function PluginDetail({ entry, onBack, plugin, store }: PluginDetailProps) {
  const id = plugin?.manifest.name ?? entry?.id ?? ''
  const displayName = plugin?.manifest.displayName ?? entry?.displayName ?? id
  const description = plugin?.manifest.description ?? entry?.description
  const trust = plugin?.trust ?? entry?.trust ?? 'third-party'
  const hue = pluginHue(id)

  return (
    <div className="pb-20">
      <button
        className="pt-6 text-xs text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        ← 插件
      </button>
      <header className="flex items-start gap-4 pt-4">
        <PluginGlyph displayName={displayName} id={id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{displayName}</h1>
            <TrustBadge trust={trust} />
          </div>
          <p className="pt-1 text-sm text-muted-foreground">
            {description ?? '这个插件没有写说明。'}
          </p>
        </div>
        {plugin === undefined ? (
          <Button
            onClick={() => {
              if (entry !== undefined) {
                store.beginInstall(entry.source)
              }
            }}
            size="sm"
          >
            + 安装插件
          </Button>
        ) : (
          <Button onClick={() => store.remove(id)} size="sm" variant="secondary">
            卸载
          </Button>
        )}
      </header>
      {plugin === undefined ? null : <Behaviour plugin={plugin} />}
      {plugin === undefined ? null : <Capabilities plugin={plugin} store={store} />}
      <section className="pt-8">
        <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          信息
        </h2>
        <dl className="divide-y divide-divider border-y border-divider">
          <InfoRow label="功能" value={joinOrDash(plugin?.manifest.capabilities ?? [])} />
          <InfoRow label="开发者" value={plugin?.manifest.developerName ?? '未署名'} />
          <InfoRow label="版本" value={plugin?.manifest.version ?? entry?.version ?? '未标注'} />
          <InfoRow label="主页" value={plugin?.manifest.homepage ?? entry?.homepage ?? '没有'} />
          <InfoRow
            label="来源"
            value={
              plugin?.source === undefined
                ? entry === undefined
                  ? '手动放进插件目录'
                  : describeInstallSource(entry.source)
                : describeInstallSource(plugin.source)
            }
          />
        </dl>
      </section>
      {plugin === undefined || plugin.diagnostics.length === 0 ? null : (
        <section className="pt-8">
          <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            诊断
          </h2>
          <ul className="divide-y divide-divider border-y border-divider">
            {plugin.diagnostics.map((diagnostic) => (
              <li className="py-3 text-xs leading-5 text-muted-foreground" key={diagnostic.detail}>
                <span className="pr-2 font-medium text-foreground">{diagnostic.code}</span>
                {diagnostic.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div
        aria-hidden="true"
        className="mt-10 h-px w-full"
        style={{ backgroundImage: `linear-gradient(90deg, oklch(0.9 0.06 ${hue}), transparent)` }}
      />
    </div>
  )
}

function joinOrDash(values: readonly string[]): string {
  return values.length === 0 ? '未声明' : values.join('、')
}

interface BehaviourProps {
  readonly plugin: InstalledPlugin
}

function Behaviour({ plugin }: BehaviourProps) {
  const { commandRoots, name, sessionStartSkill, skillRoots } = plugin.manifest
  const hue = pluginHue(name)

  const lines = [
    sessionStartSkill === undefined ? undefined : `新会话开始时自动装载技能 ${sessionStartSkill}`,
    skillRoots.length === 0 ? undefined : `技能来自 ${skillRoots.join('、')}，模型按需取用`,
    commandRoots.length === 0
      ? undefined
      : `命令来自 ${commandRoots.join('、')}，在对话里以 /${name}: 前缀调用`,
    plugin.systemPromptText === undefined ? undefined : '每次会话都会注入一段系统提示词',
  ].filter((line) => line !== undefined)

  if (lines.length === 0) {
    return null
  }

  return (
    <section
      className="mt-8 rounded-xl border border-divider p-5"
      style={{
        backgroundImage: `linear-gradient(135deg, oklch(0.97 0.03 ${hue}), transparent 70%)`,
      }}
    >
      <ul className="space-y-2">
        {lines.map((line) => (
          <li className="flex gap-2 text-sm leading-6" key={line}>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface CapabilitiesProps {
  readonly plugin: InstalledPlugin
  readonly store: PluginStore
}

function Capabilities({ plugin, store }: CapabilitiesProps) {
  const disabled = new Set(plugin.disabledMcpServers)

  return (
    <>
      <PathSection paths={plugin.manifest.skillRoots} title="技能" />
      <PathSection paths={plugin.manifest.commandRoots} title="命令" />
      <PathSection paths={plugin.manifest.agentRoots} title="代理" />
      {plugin.manifest.mcpServers.length === 0 ? null : (
        <section className="pt-8">
          <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            MCP 服务器
          </h2>
          <ul className="divide-y divide-divider border-y border-divider">
            {plugin.manifest.mcpServers.map((server) => (
              <li className="flex items-center gap-4 py-3" key={server.name}>
                <span className="flex-1 text-sm">{server.name}</span>
                <Switch
                  aria-label={`启用 ${server.name}`}
                  checked={!disabled.has(server.name)}
                  onCheckedChange={(next) =>
                    store.setMcpServerEnabled(plugin.manifest.name, server.name, next)
                  }
                  size="sm"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

interface PathSectionProps {
  readonly paths: readonly string[]
  readonly title: string
}

function PathSection({ paths, title }: PathSectionProps) {
  if (paths.length === 0) {
    return null
  }

  return (
    <section className="pt-8">
      <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ul className="divide-y divide-divider border-y border-divider">
        {paths.map((path) => (
          <li className="py-3 font-mono text-xs text-muted-foreground" key={path}>
            {path}
          </li>
        ))}
      </ul>
    </section>
  )
}

interface InfoRowProps {
  readonly label: string
  readonly value: string
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex gap-4 py-3">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-xs">{value}</dd>
    </div>
  )
}
