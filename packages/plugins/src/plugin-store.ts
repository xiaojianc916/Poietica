import { assertUnreachable, warn } from '@poietica/core'
import {
  commitPlugin,
  discardStagedPlugin,
  listPlugins,
  prunePlugins,
  readPluginCatalog,
  readPluginState,
  readPluginText,
  refreshPluginCatalog,
  stagePlugin,
  writePluginState,
} from '@poietica/ipc'

import { type ResolvedContributions, resolveContributions } from './contribution'
import { planFetch } from './fetch-plan'
import {
  describeInstallSource,
  type PluginInstallSource,
  type PluginTrustTier,
  requiresInstallConfirmation,
  UNLISTED_TRUST,
} from './install-source'
import type { InstalledPlugin } from './installation'
import { decodePluginManifest, type PluginDiagnostic, type PluginManifest } from './manifest'
import {
  beginFetch,
  completeFetch,
  failFetch,
  latestCatalog,
  MARKETPLACE_ABSENT,
  type MarketplaceState,
  parseMarketplaceOrigin,
  shouldFetchOnOpen,
} from './marketplace'
import { decodePluginLedger, encodePluginLedger, type PluginRecord } from './record'

/**
 * 「装了什么、开没开、市场上有什么」的唯一持有者。
 *
 * 屏幕上这份是盘上那份的投影。每一次改动都先把新账本写进磁盘，写成了才发布快照 ——
 * 因此不存在「界面已经变了、盘上还没变」的窗口，写失败时人看到的就是这次没改成。
 * 自动化那边是「发命令、拿原生回的整本目录当新快照」；这里 plugins_state_write 回的
 * 是 ()，所以由这一层持有账本、写成之后自己发布。两条都满足同一条不变量。
 *
 * 清单不进账本：它的真相是插件目录里那份文件，每次装载重读。所以这里没有任何一处
 * 需要「同步」两份清单。
 */

export interface PluginsViewModel {
  readonly plugins: readonly InstalledPlugin[]
  /** 五类贡献同一次遍历产出，界面上五个 tab 读的就是它，不另算一遍。 */
  readonly contributions: ResolvedContributions
  readonly marketplace: MarketplaceState
  readonly install: InstallFlow
  /** 首帧与「读完了确实一个都没装」不是同一件事，空态因此不会闪。 */
  readonly loaded: boolean
}

export interface IdleInstall {
  readonly kind: 'idle'
}

export interface StagingInstall {
  readonly kind: 'staging'
  readonly source: PluginInstallSource
}

/*
 * 已经解到暂存区、等人点头的那一份。
 *
 * 确认这一步拿到的是解码之后的清单，所以人看见的是「要装的到底是什么」，
 * 而不是一句「确定要安装吗」。上游的默认落在取消上，这里的默认是不动 ——
 * 不点就一直停在这一格，什么也没进 plugins/。
 */
export interface StagedInstall {
  readonly kind: 'staged'
  readonly stagingId: string
  readonly source: PluginInstallSource
  /* 取用时用的那一段子目录。认领的是同一层，所以它要跟着走到 commit。 */
  readonly subdirectory: string | null
  readonly manifest: PluginManifest
  readonly diagnostics: readonly PluginDiagnostic[]
  readonly trust: PluginTrustTier
}

export interface RefusedInstall {
  readonly kind: 'refused'
  readonly reason: string
}

export type InstallFlow = IdleInstall | RefusedInstall | StagedInstall | StagingInstall

export const INSTALL_IDLE: InstallFlow = { kind: 'idle' }

export interface PluginStore {
  readonly getSnapshot: () => PluginsViewModel
  readonly subscribe: (listener: () => void) => () => void
  /** 装载账本与清单，并在从未取过目录时拉一次。返回停表函数。 */
  readonly start: () => () => void
  readonly setEnabled: (pluginId: string, enabled: boolean) => void
  readonly setMcpServerEnabled: (pluginId: string, server: string, enabled: boolean) => void
  readonly remove: (pluginId: string) => void
  /**
   * 开始一次安装：下载、解压到暂存区。
   *
   * 收的是解好的结构不是字符串 —— 目录卡片手里已经有结构了，渲染成字符串再解析
   * 回来会丢掉子目录（网页地址里没有无歧义的写法）。输入框那条路自己先解析。
   */
  readonly beginInstall: (source: PluginInstallSource) => void
  readonly confirmInstall: () => void
  readonly cancelInstall: () => void
  readonly refreshMarketplace: () => void
}

export interface PluginStoreOptions {
  /**
   * 内置 agent 的名字。插件想顶掉同名的必须显式 override。
   *
   * 这个应用里它是空集，而且这是一条事实不是占位：内置 sub-agent 住在对面那个 CLI
   * 进程里，ACP 上没有任何一条消息报得出它们的名字。等哪天报得出，从这里交进来。
   */
  readonly reservedAgentNames: ReadonlySet<string>
  readonly marketplaceUrl: string
  /** 领域层不摸时钟，时钟从这里交进去。测试因此不需要冻结全局时间。 */
  readonly now: () => string
}

export function createPluginStore(options: PluginStoreOptions): PluginStore {
  const listeners = new Set<() => void>()

  /*
   * 目录里的官方条目写的是相对路径，相对的是目录文件自己所在的目录。这个上下文
   * 从目录地址一处推出来，不另外配一遍 —— 配两遍就会有一天对不上。
   */
  const origin = parseMarketplaceOrigin(options.marketplaceUrl)

  let records: readonly PluginRecord[] = []
  let snapshot: PluginsViewModel = {
    plugins: [],
    contributions: resolveContributions({ plugins: [], reservedAgentNames: new Set() }),
    marketplace: MARKETPLACE_ABSENT,
    install: INSTALL_IDLE,
    loaded: false,
  }

  /*
   * 写盘串行。
   *
   * 连着拨两个开关会开出两次读—改—写；并发跑的话后写的那次带着更旧的账本，第一个
   * 开关就被悄悄拨回去了。链成一条队列，每次都在上一次落定之后才算新账本。
   */
  let queue: Promise<void> = Promise.resolve()

  function publish(next: Partial<PluginsViewModel>): void {
    snapshot = { ...snapshot, ...next }

    for (const listener of listeners) {
      listener()
    }
  }

  function contributionsOf(plugins: readonly InstalledPlugin[]): ResolvedContributions {
    return resolveContributions({ plugins, reservedAgentNames: options.reservedAgentNames })
  }

  /*
   * 不是 async：三条分支里只有 file 那一条真的要等 IPC，另外两条当场就有答案。
   * 挂一个 async 只是让每次装载都多排一轮微任务，而它一个 await 都没有（biome 的
   * useAwait 说的就是这件事）。返回类型把「当场」和「要等」都写出来，调用方照旧
   * await —— await 一个非 Promise 是合法的，也是原样交回。
   */
  function promptTextOf(
    pluginId: string,
    manifest: PluginManifest,
  ): Promise<string | undefined> | string | undefined {
    const prompt = manifest.systemPrompt

    switch (prompt.kind) {
      case 'absent':
        return undefined
      case 'inline':
        return prompt.text
      case 'file':
        return readPluginText({ pluginId, relativePath: prompt.path })
      default:
        return assertUnreachable(prompt)
    }
  }

  /*
   * 账本说装了什么，磁盘说有什么，两边对不上时以账本为准。
   *
   * 磁盘上有、账本里没有，那是卸载留下的托管副本 —— 它不算装着。反过来账本里有、
   * 磁盘上没了，那是人手动删了目录：记一条诊断显示出来，而不是让这一行凭空消失。
   */
  async function loadInstalled(): Promise<readonly InstalledPlugin[]> {
    const [contents, payloads] = await Promise.all([readPluginState(), listPlugins()])
    const decoding = decodePluginLedger(contents)

    if (decoding.kind === 'undecodable') {
      warn('插件账本读不懂，这次不动它', { scope: 'plugins', reason: decoding.reason })

      return []
    }

    records = decoding.records

    const onDisk = new Map(payloads.map((payload) => [payload.pluginId, payload.manifestJson]))
    const installed: InstalledPlugin[] = []

    for (const record of records) {
      const manifestJson = onDisk.get(record.id)
      const { source } = record

      if (manifestJson === undefined) {
        installed.push({
          manifest: missingManifest(record.id),
          source,
          trust: record.trust,
          enabled: false,
          installedAt: record.installedAt,
          systemPromptText: undefined,
          disabledMcpServers: record.disabledMcpServers,
          diagnostics: [
            {
              code: 'manifest-invalid',
              pluginId: record.id,
              detail: '账本里记着它，但 plugins/ 下已经没有这个目录了',
            },
          ],
        })
        continue
      }

      const decoded = decodeManifestJson(record.id, manifestJson)

      if (decoded.kind === 'rejected') {
        installed.push({
          manifest: missingManifest(record.id),
          source,
          trust: record.trust,
          enabled: false,
          installedAt: record.installedAt,
          systemPromptText: undefined,
          disabledMcpServers: record.disabledMcpServers,
          diagnostics: decoded.diagnostics,
        })
        continue
      }

      installed.push({
        manifest: decoded.manifest,
        source,
        trust: record.trust,
        enabled: record.enabled,
        installedAt: record.installedAt,
        systemPromptText: await promptTextOf(record.id, decoded.manifest),
        disabledMcpServers: record.disabledMcpServers,
        diagnostics: decoded.diagnostics,
      })
    }

    return installed
  }

  function republish(plugins: readonly InstalledPlugin[], loaded: boolean): void {
    publish({ plugins, contributions: contributionsOf(plugins), loaded })
  }

  /** 写盘成了才发布。失败不动屏幕：人看到的仍然是盘上那一份。 */
  function commitRecords(next: readonly PluginRecord[], what: string): void {
    queue = queue.then(async () => {
      try {
        await writePluginState(encodePluginLedger(next))
        records = next
        republish(await loadInstalled(), true)
      } catch (cause: unknown) {
        warn(what, { scope: 'plugins', cause })
      }
    })
  }

  function patchRecord(pluginId: string, patch: (record: PluginRecord) => PluginRecord): void {
    const current = records.find((record) => record.id === pluginId)

    if (current === undefined) {
      return
    }

    commitRecords(
      records.map((record) => (record.id === pluginId ? patch(record) : record)),
      '插件账本没能写入磁盘，屏幕上仍是磁盘里那一份',
    )
  }

  function loadCatalog(): void {
    queue = queue.then(async () => {
      try {
        const contents = await readPluginCatalog()

        if (contents === null) {
          return
        }

        publish({
          marketplace: completeFetch(MARKETPLACE_ABSENT, JSON.parse(contents), '', origin),
        })
      } catch (cause: unknown) {
        warn('本地市场目录读不出来', { scope: 'plugins', cause })
      }
    })
  }

  function fetchCatalog(): void {
    queue = queue.then(async () => {
      publish({ marketplace: beginFetch(snapshot.marketplace) })

      try {
        const contents = await refreshPluginCatalog(options.marketplaceUrl)

        publish({
          marketplace: completeFetch(
            snapshot.marketplace,
            JSON.parse(contents),
            options.now(),
            origin,
          ),
        })
      } catch (cause: unknown) {
        publish({
          marketplace: failFetch(
            snapshot.marketplace,
            cause instanceof Error ? cause.message : String(cause),
          ),
        })
      }
    })
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    start() {
      queue = queue.then(async () => {
        try {
          republish(await loadInstalled(), true)
        } catch (cause: unknown) {
          warn('插件列表读取失败', { scope: 'plugins', cause })
          republish([], true)
        }
      })

      loadCatalog()

      /*
       * 只有从来没取过才自动拉一次，这条判据由 shouldFetchOnOpen 一个地方说了算。
       * 排在 loadCatalog 之后：本地那一份读完了，才知道自己算不算「从来没取过」。
       */
      queue = queue.then(() => {
        if (shouldFetchOnOpen(snapshot.marketplace)) {
          fetchCatalog()
        }
      })

      return () => {
        listeners.clear()
      }
    },

    setEnabled(pluginId, enabled) {
      patchRecord(pluginId, (record) => ({ ...record, enabled }))
    },

    setMcpServerEnabled(pluginId, server, enabled) {
      patchRecord(pluginId, (record) => ({
        ...record,
        disabledMcpServers: enabled
          ? record.disabledMcpServers.filter((name) => name !== server)
          : [...record.disabledMcpServers, server],
      }))
    },

    /*
     * 删记录，然后让磁盘跟着账目走。
     *
     * 上游卸载只删记录、留着托管副本，于是 plugins/ 只增不减 —— 那是一堆没人再看
     * 一眼的目录。plugins_prune 收的是「还算装着的那些」，删的是其余全部，一次调用
     * 就把两边对齐，不需要按 id 逐个删的第二条路径。
     */
    remove(pluginId) {
      const next = records.filter((record) => record.id !== pluginId)

      commitRecords(next, '插件没能从账本里删掉，屏幕上仍是磁盘里那一份')

      queue = queue.then(async () => {
        try {
          await prunePlugins(next.map((record) => record.id))
        } catch (cause: unknown) {
          warn('托管副本没能清理，账本已经删掉了这一条', { scope: 'plugins', cause })
        }
      })
    },

    beginInstall(source) {
      const planning = planFetch(source)

      if (planning.kind === 'unplannable') {
        publish({ install: { kind: 'refused', reason: planning.reason } })

        return
      }

      publish({ install: { kind: 'staging', source } })

      const subdirectory = planning.plan.kind === 'archive' ? planning.plan.subdirectory : null

      queue = queue.then(async () => {
        try {
          const staged = await stagePlugin(planning.plan)
          const decoded = decodeManifestJson('', staged.manifestJson)

          if (decoded.kind === 'rejected') {
            await discardStagedPlugin(staged.stagingId)
            publish({
              install: {
                kind: 'refused',
                reason: decoded.diagnostics.map((entry) => entry.detail).join('; '),
              },
            })

            return
          }

          const trust = trustOf(source)

          publish({
            install: {
              kind: 'staged',
              stagingId: staged.stagingId,
              source,
              subdirectory,
              manifest: decoded.manifest,
              diagnostics: decoded.diagnostics,
              trust,
            },
          })

          /* 官方来源不拦；其余一律等人点头，这条判据只有 install-source 说了算。 */
          if (!requiresInstallConfirmation(trust)) {
            adopt(staged.stagingId, decoded.manifest.name, source, subdirectory, trust)
          }
        } catch (cause: unknown) {
          publish({
            install: {
              kind: 'refused',
              reason: cause instanceof Error ? cause.message : String(cause),
            },
          })
        }
      })
    },

    confirmInstall() {
      const { install } = snapshot

      if (install.kind !== 'staged') {
        return
      }

      adopt(
        install.stagingId,
        install.manifest.name,
        install.source,
        install.subdirectory,
        install.trust,
      )
    },

    cancelInstall() {
      const { install } = snapshot

      publish({ install: INSTALL_IDLE })

      if (install.kind !== 'staged') {
        return
      }

      queue = queue.then(async () => {
        try {
          await discardStagedPlugin(install.stagingId)
        } catch (cause: unknown) {
          warn('暂存目录没能丢掉', { scope: 'plugins', cause })
        }
      })
    },

    refreshMarketplace: fetchCatalog,
  }

  /** 认领：暂存区那一份挪进 plugins/<name>/，然后记账。 */
  function adopt(
    stagingId: string,
    pluginId: string,
    source: PluginInstallSource,
    subdirectory: string | null,
    trust: PluginTrustTier,
  ): void {
    queue = queue.then(async () => {
      try {
        await commitPlugin({ stagingId, pluginId, subdirectory })
      } catch (cause: unknown) {
        publish({
          install: {
            kind: 'refused',
            reason: cause instanceof Error ? cause.message : String(cause),
          },
        })

        return
      }

      publish({ install: INSTALL_IDLE })
      commitRecords(
        [
          ...records.filter((record) => record.id !== pluginId),
          {
            id: pluginId,
            source,
            trust,
            enabled: true,
            installedAt: options.now(),
            disabledMcpServers: [],
          },
        ],
        '插件装好了但账本没写进去',
      )
    })
  }

  /*
   * 目录里那条记录说这个来源是什么信任级别，说不上来就是第三方。
   *
   * 不从 URL 猜 —— 猜出来的信任是最坏的一种信任，install-source 那句注释说的就是
   * 这件事。这里只是把目录已经声明过的事实查回来。
   */
  function trustOf(source: PluginInstallSource): PluginTrustTier {
    const catalog = latestCatalog(snapshot.marketplace)
    const wanted = describeInstallSource(source)

    /*
     * 按渲染出来的那一行字比，不按对象比。上一版写的是 entry.source === parse(...)，
     * 两个新造出来的对象做引用比较永远为 false —— 于是目录里明明标着官方的条目也
     * 一路落到第三方，信任级别从来没生效过。
     */
    const listed = catalog?.entries.find((entry) => describeInstallSource(entry.source) === wanted)

    return listed?.trust ?? UNLISTED_TRUST
  }
}

/* 清单读不出来时的替身：界面要显示这一行「它为什么没生效」，而不是让它凭空消失。 */
function missingManifest(name: string): PluginManifest {
  return {
    name,
    displayName: name,
    description: undefined,
    version: undefined,
    developerName: undefined,
    homepage: undefined,
    skills: [],
    agents: [],
    commands: [],
    mcpServers: [],
    systemPrompt: { kind: 'absent' },
  }
}

function decodeManifestJson(pluginId: string, contents: string) {
  try {
    return decodePluginManifest(JSON.parse(contents))
  } catch (cause: unknown) {
    return {
      kind: 'rejected' as const,
      diagnostics: [
        {
          code: 'manifest-invalid' as const,
          pluginId,
          detail: cause instanceof Error ? cause.message : String(cause),
        },
      ],
    }
  }
}
