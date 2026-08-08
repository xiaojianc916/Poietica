import { assertUnreachable } from '@poietica/core'
import { Button, Switch } from '@poietica/ui'
import { useState, useSyncExternalStore } from 'react'

import type { ResolvedMcpServer } from '../contribution'
import type { InstalledPlugin } from '../installation'
import { latestCatalog } from '../marketplace'
import type { PluginStore } from '../plugin-store'
import { ContributionList, type ContributionRow } from './contribution-list'
import { PluginBrowser } from './plugin-browser'
import { PluginDetail } from './plugin-detail'

/*
 * Tool 里的插件界面。
 *
 * 三格：插件是目录与已装列表，技能与 MCP 是「已经装进来的东西按种类看一遍」。
 * 它们不是三种插件 —— 插件是打包与分发单位，技能与 MCP 服务器是它带进来的能力，
 * 所以这两格永远是插件的投影，而不是并列的第二套安装系统。
 *
 * 两格都列全部，包括关掉的：拨到关就消失、再也开不回来，那不是开关，是删除。
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
    subtitle: '通过任务专用的技能扩展 AI 的能力。目前技能都随插件一起装载。',
  },
  mcp: {
    label: 'MCP',
    title: 'MCP 服务器',
    subtitle: '插件声明的外部工具服务器。每一台可以单独拨开或关掉。',
  },
} as const satisfies Record<string, PluginTab>

type PluginTabId = keyof typeof TABS

const TAB_ORDER = Object.keys(TABS) as readonly PluginTabId[]

export interface PluginsSurfaceProps {
  readonly store: PluginStore
}

export function PluginsSurface({ store }: PluginsSurfaceProps) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [tab, setTab] = useState<PluginTabId>('plugins')
  const [needle, setNeedle] = useState('')
  const [openedId, setOpenedId] = useState<string | undefined>(undefined)

  const counts: Record<PluginTabId, number> = {
    plugins: view.plugins.length,
    skills: view.contributions.skillRoots.length,
    mcp: view.contributions.mcpServers.length,
  }

  if (openedId !== undefined) {
    return (
      <div className="h-full overflow-y-auto bg-ground">
        <div className="mx-auto max-w-4xl px-8">
          <PluginDetail
            entry={latestCatalog(view.marketplace)?.entries.find((one) => one.id === openedId)}
            onBack={() => setOpenedId(undefined)}
            plugin={view.plugins.find((one) => one.manifest.name === openedId)}
            store={store}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-ground">
      <div className="sticky top-0 z-10 border-b border-divider bg-ground/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-8 py-3">
          {TAB_ORDER.map((one) => (
            <button
              className={
                one === tab
                  ? 'rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground'
                  : 'rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground'
              }
              key={one}
              onClick={() => setTab(one)}
              type="button"
            >
              {TABS[one].label}
              <span className="pl-1.5 tabular-nums opacity-60">{counts[one]}</span>
            </button>
          ))}
          <span className="flex-1" />
          <Button onClick={() => store.refreshMarketplace()} size="xs" variant="ghost">
            刷新
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-8 pt-10">
        <h1 className="text-2xl font-semibold tracking-tight">{TABS[tab].title}</h1>
        <p className="max-w-xl pt-2 text-xs leading-5 text-muted-foreground">
          {TABS[tab].subtitle}
        </p>
        <input
          className="mt-6 h-9 w-full rounded-lg border border-divider bg-background px-3 text-sm outline-none focus:border-foreground/25"
          onChange={(event) => setNeedle(event.target.value)}
          placeholder={`搜索${TABS[tab].label}`}
          value={needle}
        />
        <TabBody needle={needle} onOpen={setOpenedId} store={store} tab={tab} view={view} />
      </div>
    </div>
  )
}

interface TabBodyProps {
  readonly tab: PluginTabId
  readonly needle: string
  readonly store: PluginStore
  readonly view: ReturnType<PluginStore['getSnapshot']>
  readonly onOpen: (id: string) => void
}

function TabBody({ needle, onOpen, store, tab, view }: TabBodyProps) {
  const keep = (row: ContributionRow): boolean =>
    needle === '' ||
    `${row.title}${row.detail}${row.pluginId}`.toLowerCase().includes(needle.toLowerCase())

  switch (tab) {
    case 'plugins':
      return (
        <PluginBrowser
          install={view.install}
          loaded={view.loaded}
          marketplace={view.marketplace}
          needle={needle}
          onOpen={onOpen}
          plugins={view.plugins}
          store={store}
        />
      )
    case 'skills':
      return (
        <ContributionList
          empty="还没有插件带来技能。"
          rows={view.plugins
            .filter((plugin) => plugin.manifest.skillRoots.length > 0)
            .map((plugin) => skillRow(plugin, store))
            .filter(keep)}
        />
      )
    case 'mcp':
      return (
        <ContributionList
          empty="还没有插件声明 MCP 服务器。"
          rows={view.contributions.mcpServers
            .map((server) => serverRow(server, store))
            .filter(keep)}
        />
      )
    default:
      return assertUnreachable(tab)
  }
}

function skillRow(plugin: InstalledPlugin, store: PluginStore): ContributionRow {
  const { displayName, name, sessionStartSkill, skillRoots } = plugin.manifest

  return {
    key: name,
    title: displayName,
    detail:
      sessionStartSkill === undefined
        ? `技能目录 ${skillRoots.join('、')}`
        : `技能目录 ${skillRoots.join('、')} · 会话开始自动装载 ${sessionStartSkill}`,
    pluginId: name,
    trailing: (
      <Switch
        aria-label={`启用 ${displayName} 的技能`}
        checked={plugin.enabled}
        onCheckedChange={(next) => store.setEnabled(name, next)}
        size="sm"
      />
    ),
  }
}

/*
 * enabled 是这一台自己的开关，active 是「会话里真的会启动」。两个都要显示：
 * 插件整体关掉时这一台的开关不该被悄悄拨回去，但也不能让人以为它还在跑。
 */
function serverRow(server: ResolvedMcpServer, store: PluginStore): ContributionRow {
  return {
    key: `${server.pluginId}/${server.name}`,
    title: server.name,
    detail: server.enabled
      ? server.active
        ? '会话开始时启动'
        : '插件已关闭，这一台不会启动'
      : '已关闭',
    pluginId: server.pluginId,
    trailing: (
      <Switch
        aria-label={`启用 ${server.name}`}
        checked={server.enabled}
        onCheckedChange={(next) => store.setMcpServerEnabled(server.pluginId, server.name, next)}
        size="sm"
      />
    ),
  }
}
