import { assertUnreachable } from '@poietica/core'
import { Button, Switch } from '@poietica/ui'
import { useState, useSyncExternalStore } from 'react'

import type { PluginStore } from '../plugin-store'
import { ContributionList, type ContributionRow } from './contribution-list'
import { PluginBrowser } from './plugin-browser'

/**
 * Tool 那一格。
 *
 * 一个 tab 的准入条件是「这东西能不能被单独装上、单独拨开」。插件能；技能能；
 * MCP 服务器能（每一台各有开关）。命令与代理不能 —— 没有人「安装一条命令」，
 * 它们是插件装上之后附带产生的能力，摆成平级的 tab 会让人以为那是另一类可管理
 * 的东西。它们出现在插件那一行的能力摘要里，那才是它们的位置。
 *
 * 角标上的数字与列表读同一份 ResolvedContributions，因此不会出现「写着 3 台服务器、
 * 点进去列了 4 条」。
 */

interface PluginTab {
  readonly label: string
  readonly title: string
  readonly subtitle: string
}

const TABS = {
  plugins: {
    label: '插件',
    title: '插件',
    subtitle: '在你常用的工具中与 AI 协作。装上一个插件，它带来的能力就出现在对话里。',
  },
  skills: {
    label: '技能',
    title: '技能',
    subtitle: '通过任务专用的技能扩展 AI 的能力。技能随插件一起装载。',
  },
  mcp: {
    label: 'MCP',
    title: 'MCP 服务器',
    subtitle: '插件声明的外部工具服务器。每一台可以单独拨开或关掉。',
  },
} as const satisfies Record<string, PluginTab>

type PluginTabId = keyof typeof TABS

const TAB_ORDER = Object.keys(TABS) as readonly PluginTabId[]

const DESCRIPTORS: Record<PluginTabId, PluginTab> = TABS

export interface PluginsSurfaceProps {
  readonly store: PluginStore
}

export function PluginsSurface({ store }: PluginsSurfaceProps) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [tab, setTab] = useState<PluginTabId>('plugins')
  const [query, setQuery] = useState('')

  const counts: Record<PluginTabId, number> = {
    plugins: view.plugins.length,
    skills: view.contributions.skills.length,
    mcp: view.contributions.mcpServers.length,
  }

  const descriptor = DESCRIPTORS[tab]
  const needle = query.trim().toLowerCase()

  /* 搜索是这一屏的过滤器，不是一次跳转：过滤在渲染时做，不进 store。 */
  const keep = (row: ContributionRow) =>
    needle === '' || `${row.title} ${row.detail} ${row.pluginId}`.toLowerCase().includes(needle)

  return (
    <section className="h-full overflow-y-auto bg-ground">
      <div className="sticky top-0 z-10 border-b border-divider bg-ground/85 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between px-8">
          <nav className="flex gap-1">
            {TAB_ORDER.map((id) => (
              <button
                aria-current={id === tab ? 'page' : undefined}
                className={
                  id === tab
                    ? 'rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground'
                    : 'rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
                }
                key={id}
                onClick={() => {
                  setTab(id)
                }}
                type="button"
              >
                {DESCRIPTORS[id].label}
                {counts[id] > 0 ? (
                  <span className="ml-1.5 tabular-nums opacity-50">{counts[id]}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <Button
            disabled={view.marketplace.kind === 'fetching'}
            onClick={store.refreshMarketplace}
            size="xs"
            type="button"
            variant="ghost"
          >
            {view.marketplace.kind === 'fetching' ? '正在刷新…' : '刷新'}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-8 pb-20 pt-10">
        <h1 className="text-2xl font-semibold tracking-tight">{descriptor.title}</h1>

        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {descriptor.subtitle}
        </p>

        <input
          aria-label={`搜索${descriptor.label}`}
          className="mt-6 w-full rounded-lg border border-divider bg-background px-3.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/25"
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder={`搜索${descriptor.label}`}
          type="search"
          value={query}
        />

        <div className="mt-8">
          <TabBody keep={keep} needle={needle} store={store} tab={tab} view={view} />
        </div>
      </div>
    </section>
  )
}

interface TabBodyProps {
  readonly tab: PluginTabId
  readonly view: ReturnType<PluginStore['getSnapshot']>
  readonly keep: (row: ContributionRow) => boolean
  readonly needle: string
  readonly store: PluginStore
}

function TabBody({ tab, view, keep, needle, store }: TabBodyProps) {
  switch (tab) {
    case 'plugins':
      return (
        <PluginBrowser
          install={view.install}
          loaded={view.loaded}
          marketplace={view.marketplace}
          needle={needle}
          plugins={view.plugins}
          store={store}
        />
      )

    case 'skills':
      return (
        <ContributionList
          empty="装着的插件没有带来技能。"
          rows={view.contributions.skills
            .map((skill) => ({
              key: `${skill.pluginId}:${skill.path}`,
              title: skill.path,
              detail: '会话开始时随插件一起加载',
              pluginId: skill.pluginId,
            }))
            .filter(keep)}
        />
      )

    case 'mcp':
      return (
        <ContributionList
          empty="装着的插件没有带来 MCP 服务器。"
          rows={view.contributions.mcpServers
            .map((server) => ({
              key: `${server.pluginId}:${server.name}`,
              title: server.name,
              detail: '由插件声明的 MCP 服务器',
              pluginId: server.pluginId,
              trailing: (
                <Switch
                  aria-label={`启用 ${server.name}`}
                  checked
                  onCheckedChange={() => {
                    store.setMcpServerEnabled(server.pluginId, server.name, false)
                  }}
                  size="sm"
                />
              ),
            }))
            .filter(keep)}
        />
      )

    default:
      return assertUnreachable(tab)
  }
}
