import { assertUnreachable } from '@poietica/core'
import { Switch } from '@poietica/ui'
import { useState, useSyncExternalStore } from 'react'

import type { PluginStore } from '../plugin-store'
import { ContributionList, type ContributionRow } from './contribution-list'
import { InstalledPlugins } from './installed-plugins'

/**
 * Tool 那一格。
 *
 * 一个种类一个 tab，而这几个种类不是在这里手写的第二份名单 —— 它们就是
 * resolveContributions 产出的那几个字段。角标上的数字读同一份，因此不会出现
 * 「写着 3 台服务器、点进去列了 4 条」。
 *
 * 页头与版式取自同类产品的插件目录页：标题、搜索、tab 条、列表。没有取的是
 * 「Featured」那种编辑推荐位 —— 那需要一个有编辑在运营的市场，这里的目录是一份
 * 拉回来的 JSON，摆出推荐位只是把同一批条目换个大小再画一遍。
 */

type PluginTabId = 'plugins' | 'skills' | 'commands' | 'agents' | 'mcp'

const TABS: Record<PluginTabId, string> = {
  plugins: '插件',
  skills: '技能',
  commands: '命令',
  agents: '代理',
  mcp: 'MCP',
}

const TAB_ORDER: readonly PluginTabId[] = ['plugins', 'skills', 'commands', 'agents', 'mcp']

export interface PluginsSurfaceProps {
  readonly store: PluginStore
}

export function PluginsSurface({ store }: PluginsSurfaceProps) {
  const { plugins, contributions, marketplace, install, loaded } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  const [tab, setTab] = useState<PluginTabId>('plugins')
  const [query, setQuery] = useState('')

  const counts: Record<PluginTabId, number> = {
    plugins: plugins.length,
    skills: contributions.skills.length,
    commands: contributions.commands.length,
    agents: contributions.agents.length,
    mcp: contributions.mcpServers.length,
  }

  /* 搜索是这一屏的过滤器，不是一次跳转：过滤在渲染时做，不进 store。 */
  const keep = (row: ContributionRow) =>
    query.trim() === '' ||
    `${row.title} ${row.detail} ${row.pluginId}`.toLowerCase().includes(query.trim().toLowerCase())

  return (
    <section className="h-full overflow-y-auto bg-ground">
      <header className="px-8 pb-4 pt-8">
        <h1 className="text-lg font-semibold tracking-tight">Tool</h1>

        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          插件把技能、命令、代理与 MCP 服务器一起带进来。装上、拨开，它们就出现在对话里。
        </p>

        <input
          aria-label="搜索"
          className="mt-4 w-full rounded-md bg-muted px-3 py-1.5 text-xs outline-none"
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="搜索插件、技能、命令、代理与服务器"
          value={query}
        />

        <nav className="mt-4 flex gap-1 border-b border-divider">
          {TAB_ORDER.map((id) => (
            <button
              aria-current={id === tab ? 'page' : undefined}
              className={
                id === tab
                  ? 'border-b-2 border-foreground px-3 pb-2 text-xs font-medium text-foreground'
                  : 'border-b-2 border-transparent px-3 pb-2 text-xs text-muted-foreground hover:text-foreground'
              }
              key={id}
              onClick={() => {
                setTab(id)
              }}
              type="button"
            >
              {TABS[id]}
              <span className="ml-1.5 tabular-nums opacity-60">{counts[id]}</span>
            </button>
          ))}
        </nav>
      </header>

      <TabBody
        keep={keep}
        store={store}
        tab={tab}
        view={{ plugins, contributions, marketplace, install, loaded }}
      />
    </section>
  )
}

interface TabBodyProps {
  readonly tab: PluginTabId
  readonly view: ReturnType<PluginStore['getSnapshot']>
  readonly keep: (row: ContributionRow) => boolean
  readonly store: PluginStore
}

function TabBody({ tab, view, keep, store }: TabBodyProps) {
  const { contributions } = view

  switch (tab) {
    case 'plugins':
      return (
        <InstalledPlugins
          install={view.install}
          loaded={view.loaded}
          marketplace={view.marketplace}
          plugins={view.plugins}
          store={store}
        />
      )

    case 'skills':
      return (
        <ContributionList
          empty="装着的插件没有带来技能。"
          rows={contributions.skills
            .map((skill) => ({
              key: `${skill.pluginId}:${skill.path}`,
              title: skill.path,
              detail: '会话开始时随插件一起加载',
              pluginId: skill.pluginId,
            }))
            .filter(keep)}
        />
      )

    case 'commands':
      return (
        <ContributionList
          empty="装着的插件没有带来命令。"
          rows={contributions.commands
            .map((command) => ({
              key: command.id,
              title: `/${command.id}`,
              detail: command.description,
              pluginId: command.pluginId,
            }))
            .filter(keep)}
        />
      )

    case 'agents':
      return (
        <ContributionList
          empty="装着的插件没有带来代理。"
          rows={contributions.agents
            .map((agent) => ({
              key: `${agent.pluginId}:${agent.name}`,
              title: agent.name,
              detail: '可在对话里点名调用',
              pluginId: agent.pluginId,
            }))
            .filter(keep)}
        />
      )

    case 'mcp':
      return (
        <ContributionList
          empty="装着的插件没有带来 MCP 服务器。"
          rows={contributions.mcpServers
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
