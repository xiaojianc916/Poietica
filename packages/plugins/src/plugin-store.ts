import { assertUnreachable, createPreference, warn } from '@poietica/core'
import {
  commitPlugin,
  discardStagedPlugin,
  listPlugins,
  prunePlugins,
  readEnvironmentMcpConfig,
  readMcpEndpoint,
  readPluginCatalog,
  readPluginState,
  readPluginText,
  refreshPluginCatalog,
  stagePlugin,
  writePluginState,
} from '@poietica/ipc'

import {
  type BuiltinMcpServer,
  type ResolvedContributions,
  resolveContributions,
} from './contribution'
import { planFetch } from './fetch-plan'
import {
  describeInstallSource,
  type PluginInstallSource,
  type PluginTrustTier,
  requiresInstallConfirmation,
  UNLISTED_TRUST,
} from './install-source'
import type { InstalledPlugin } from './installation'
import {
  clampPluginPrompt,
  decodePluginManifest,
  type PluginDiagnostic,
  type PluginManifest,
  type PluginPromptSource,
} from './manifest'
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
import { type DeclaredMcpServer, decodeMcpConfig } from './mcp-config'
import type { ManagedOrigin } from './origin'
import {
  DEFAULT_PREFERENCE,
  decodePluginPreferences,
  encodePluginPreferences,
  type PluginPreference,
} from './preferences'

/**
 * 「装了什么、开没开、市场上有什么」的唯一持有者。
 *
 * 装了什么由磁盘说了算：plugins/ 下每一个带清单的目录就是一个装着的插件。偏好
 * 文件只往上叠开关与出身，叠不上就走默认档 —— 因此偏好读不出来最坏是「开关回到
 * 默认」，绝不会变成「一个都没装」。
 *
 * 屏幕上这份是盘上那份的投影：每一次改动都先落盘，写成了才发布快照，所以不存在
 * 「界面已经变了、盘上还没变」的窗口。
 */

export interface PluginsViewModel {
  readonly plugins: readonly InstalledPlugin[]
  /* 各类贡献同一次遍历产出，界面上几个 tab 读的就是它，不另算一遍。 */
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
 * 确认这一步拿到的是解码之后的清单，所以人看见的是「要装的到底是什么」，而不是
 * 一句「确定要安装吗」。不点就一直停在这一格，什么也没进 plugins/。
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
  /** 扫盘、叠偏好，并在从未取过目录时拉一次。返回停表函数。 */
  readonly start: () => () => void
  readonly setEnabled: (pluginId: string, enabled: boolean) => void
  /**
   * 拨动一台服务器。
   *
   * 收的是来源而不是插件号：内置那台不属于任何插件，硬塞进插件偏好就得给它编一个
   * 假的插件号。机器上那些根本不在 ManagedOrigin 里，所以「它们改不了」由编译器说，
   * 不靠调用方自觉。
   */
  readonly setMcpServerEnabled: (target: ManagedOrigin, server: string, enabled: boolean) => void
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
  readonly marketplaceUrl: string
  /** 领域层不摸时钟，时钟从这里交进去。测试因此不需要冻结全局时间。 */
  readonly now: () => string
}

/*
 * 盘上那一份。
 *
 * 目录里有哪些插件、清单怎么写、提示词正文是什么，只在装、卸、启动这三件事发生时变。
 * 开关、出身、装载时刻只在人拨开关时变。两者共用一条刷新路径，代价就是拨一下开关要把
 * plugins/ 整个重扫一遍 —— 为了得知一个已经在内存里的布尔值。
 *
 * preferences.ts 顶上引的 VS Code、Obsidian、Zed 三家，扫描与开关本来就是分开的两套：
 * VS Code 切 enablement 不触发 extension scan，Obsidian 的 enabledPlugins 不触发 manifest
 * 扫描。方向那一半抄对了，刷新路径这一半没有。
 */
interface ScannedPlugin {
  /** plugins/ 下的目录名。偏好按它寻址，清单里的 name 未必与它相同。 */
  readonly pluginId: string
  readonly manifest: PluginManifest
  readonly systemPromptText: string | undefined
  readonly diagnostics: readonly PluginDiagnostic[]
  /** 清单读不出来的目录仍然装着，但它不受偏好里那个开关支配。 */
  readonly readable: boolean
}

/*
 * 本进程自带的那台服务器叫什么。
 *
 * 名字要稳定且与界面语言无关：它会作为工具名的前缀出现在会话里，跟着界面语言变，
 * 同一段对话历史里的工具名就会前后对不上。
 */
const BUILTIN_SERVER_NAME = 'poietica-automations'

export function createPluginStore(options: PluginStoreOptions): PluginStore {
  const listeners = new Set<() => void>()

  /*
   * 目录里的官方条目写的是相对路径，相对的是目录文件自己所在的目录。这个上下文
   * 从目录地址一处推出来，不另外配一遍 —— 配两遍就会有一天对不上。
   */
  const origin = parseMarketplaceOrigin(options.marketplaceUrl)

  /*
   * 内置那台的开关。
   *
   * 走 createPreference 是因为它必须在第一帧就有答案 —— 异步的设置管线会让这一行
   * 先画成关的再跳成开的。默认开着，所以只有「关掉」需要落盘：编码交回 null 就是
   * 删掉这个键，盘上因此不会堆一堆等于默认值的记录。
   */
  const builtinEnabled = createPreference<boolean>({
    key: 'poietica.mcp.builtin.enabled',
    fallback: true,
    decode: (raw) => raw !== 'false',
    encode: (value) => (value ? null : 'false'),
    onFailure: (failure) => {
      warn('内置 MCP 服务器的开关没能存下来', { scope: 'plugins', ...failure })
    },
  })

  let scanned: readonly ScannedPlugin[] = []
  let preferences = new Map<string, PluginPreference>()
  /* 这个 agent 自己那份 mcp.json 里的服务器。读不出来就是空。 */
  let environment: readonly DeclaredMcpServer[] = []
  /* 原生侧登记的那个地址。绑不上端口时缺席，那一行照样显示并说明原因。 */
  let builtinUrl: string | undefined
  let snapshot: PluginsViewModel = {
    plugins: [],
    contributions: resolveContributions({ builtin: [], environment: [], plugins: [] }),
    marketplace: MARKETPLACE_ABSENT,
    install: INSTALL_IDLE,
    loaded: false,
  }

  /*
   * 写盘串行。
   *
   * 连着拨两个开关会开出两次读—改—写；并发跑的话后写的那次带着更旧的偏好，第一个
   * 开关就被悄悄拨回去了。链成一条队列，每次都在上一次落定之后才算新偏好。
   */
  let queue: Promise<void> = Promise.resolve()

  function publish(next: Partial<PluginsViewModel>): void {
    snapshot = { ...snapshot, ...next }

    for (const listener of listeners) {
      listener()
    }
  }

  /*
   * 偏好投在扫描结果上，发布出去。
   *
   * 这一步没有 I/O。磁盘那一份在 scanned 里，人拨过的开关在 preferences 里，屏幕上那一份
   * 是两者的投影，不是第三份需要各自同步的副本。走到这里就意味着盘上那一份已经读过一遍，
   * 所以 loaded 恒真。
   */
  function republish(): void {
    const plugins: readonly InstalledPlugin[] = scanned.map((entry) => {
      const preference = preferences.get(entry.pluginId) ?? DEFAULT_PREFERENCE

      return {
        pluginId: entry.pluginId,
        manifest: entry.manifest,
        source: preference.source,
        trust: preference.trust,
        enabled: entry.readable && preference.enabled,
        installedAt: preference.installedAt,
        systemPromptText: entry.systemPromptText,
        disabledMcpServers: preference.disabledMcpServers,
        diagnostics: entry.diagnostics,
      }
    })

    publish({
      plugins,
      contributions: resolveContributions({ builtin: builtinServers(), environment, plugins }),
      loaded: true,
    })
  }

  /*
   * 把清单声明的几段提示词读成一段。
   *
   * 顺序就是清单里的顺序（内联在前，文件在后），预算在拼完之后才算 —— 32 KiB 说的
   * 是这个插件最终注入多少字节，而那要读完文件才知道。
   */
  async function promptTextOf(
    pluginId: string,
    sources: readonly PluginPromptSource[],
    diagnostics: PluginDiagnostic[],
  ): Promise<string | undefined> {
    const parts: string[] = []

    for (const source of sources) {
      switch (source.kind) {
        case 'inline':
          parts.push(source.text)
          break
        case 'file':
          try {
            parts.push(await readPluginText({ pluginId, relativePath: source.path }))
          } catch (cause: unknown) {
            warn('插件提示词读不出来', { scope: 'plugins', pluginId, cause })
          }
          break
        default:
          return assertUnreachable(source)
      }
    }

    const clamped = clampPluginPrompt(pluginId, parts.join('\n\n'))

    diagnostics.push(...clamped.diagnostics)

    return clamped.text
  }

  /*
   * 扫一个目录：把清单解出来，把提示词读进来。只有磁盘上那一份，不含任何偏好。
   *
   * 这是这条路上全部的开销所在 —— 一次 JSON 解析、一次 schema 校验、每条 file 来源一趟
   * 原生读文件。它只在装、卸、启动时发生。
   */
  async function scan(pluginId: string, manifestJson: string): Promise<ScannedPlugin> {
    const decoded = decodeManifestJson(pluginId, manifestJson)

    if (decoded.kind === 'rejected') {
      return {
        pluginId,
        manifest: unreadableManifest(pluginId),
        systemPromptText: undefined,
        diagnostics: decoded.diagnostics,
        readable: false,
      }
    }

    const diagnostics = [...decoded.diagnostics]

    return {
      pluginId,
      manifest: decoded.manifest,
      systemPromptText: await promptTextOf(pluginId, decoded.manifest.promptSources, diagnostics),
      diagnostics,
      readable: true,
    }
  }

  /*
   * 这个 agent 自己那份 mcp.json 里已经配好的服务器。
   *
   * 不是「这台机器上的所有 MCP」：Cursor、Claude Desktop、Windsurf 各有各的配置文件，
   * 这个 agent 一个都不读，列出来只会得到一排拨了不生效的开关。哪一份算数由原生侧
   * 的 agent_data_home 说了算，这里不猜路径。
   *
   * 原生侧只交正文，形状的解释在这里做 —— 规范的解码全仓只有 mcp-config 一处。
   * 文件不在是常态，不是错误；文件在却不是这个形状要说出来，否则人会以为自己写的
   * 那几台凭空消失了。
   */
  async function readEnvironment(): Promise<void> {
    const file = await readEnvironmentMcpConfig()

    if (file.contents === null) {
      environment = []

      return
    }

    const decoded = decodeMcpConfig(
      { kind: 'user', location: file.location },
      JSON.parse(file.contents),
    )

    if (decoded.malformed) {
      warn('这个 agent 的 mcp.json 不是预期的形状', {
        scope: 'plugins',
        location: file.location,
      })
    }

    environment = decoded.servers
  }

  /*
   * 原生侧那台服务器的地址。
   *
   * 它在应用启动时就绑好了（apps/desktop/src-tauri/src/mcp.rs 的 serve），这里只问
   * 一次 —— 端口由内核分配，两边都不需要事先约定一个数字。绑不上时交回 null。
   */
  async function readBuiltinEndpoint(): Promise<void> {
    builtinUrl = (await readMcpEndpoint())?.url
  }

  /*
   * 内置那台永远在列表里，哪怕地址没问到。
   *
   * 起不来就不显示，人看到的是「它凭空消失了」；显示出来并写明原因，人才知道该去看
   * 端口还是去看日志。与「关掉的插件照样列出来」同一条理由。
   */
  function builtinServers(): readonly BuiltinMcpServer[] {
    return [{ name: BUILTIN_SERVER_NAME, url: builtinUrl, enabled: builtinEnabled.read() }]
  }

  /* 偏好是一个小文件。盘上装了什么不由它决定，所以重读它不必回头再数一遍目录。 */
  async function readPreferences(): Promise<void> {
    preferences = new Map(decodePluginPreferences(await readPluginState()))
  }

  /*
   * 装了什么，磁盘说了算。
   *
   * 偏好里有、磁盘上没有的那些不是「丢失的插件」，是卸载之后留下的旧记录，忽略即可。
   * 反过来才要紧：磁盘上有、偏好里没有的必须显示成装着的 —— 否则人会在目录里看到
   * 一个「安装」按钮，而那个插件明明已经在盘上了。
   *
   * 只有装、卸、启动会走到这里。扫描不读偏好，所以两件事可以并着做。
   */
  async function rescan(): Promise<void> {
    const [payloads] = await Promise.all([listPlugins(), readPreferences()])

    scanned = await Promise.all(
      payloads.map((payload) => scan(payload.pluginId, payload.manifestJson)),
    )
  }

  /*
   * 写盘成了才发布。失败不动屏幕：人看到的仍然是盘上那一份。
   *
   * refresh 说的是这次改动之后还要重新知道什么。拨开关只改偏好，plugins/ 目录一个字节
   * 没动，重扫一遍是白扫；装与卸改的是目录本身，那才必须回盘上重新数。
   */
  function commitPreferences(
    next: Map<string, PluginPreference>,
    what: string,
    refresh: () => Promise<void>,
  ): void {
    queue = queue.then(async () => {
      try {
        await writePluginState(encodePluginPreferences(next))
        await refresh()

        republish()
      } catch (cause: unknown) {
        warn(what, { scope: 'plugins', cause })
      }
    })
  }

  function patchPreference(
    pluginId: string,
    patch: (preference: PluginPreference) => PluginPreference,
  ): void {
    const next = new Map(preferences)

    next.set(pluginId, patch(next.get(pluginId) ?? DEFAULT_PREFERENCE))

    commitPreferences(next, '插件偏好没能写入磁盘，屏幕上仍是磁盘里那一份', readPreferences)
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
          await rescan()
        } catch (cause: unknown) {
          warn('插件列表读取失败', { scope: 'plugins', cause })

          scanned = []
        }

        republish()
      })

      queue = queue.then(async () => {
        try {
          await readEnvironment()
        } catch (cause: unknown) {
          warn('这个 agent 的 mcp.json 读不出来', { scope: 'plugins', cause })

          environment = []
        }

        republish()
      })

      queue = queue.then(async () => {
        try {
          await readBuiltinEndpoint()
        } catch (cause: unknown) {
          warn('内置 MCP 服务器的地址问不出来', { scope: 'plugins', cause })

          builtinUrl = undefined
        }

        republish()
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
      patchPreference(pluginId, (preference) => ({ ...preference, enabled }))
    },

    setMcpServerEnabled(target, server, enabled) {
      /*
       * 内置那台不落在插件偏好里：那份文件的形状是「按插件号索引的一张表」，塞一个
       * 不存在的插件进去，卸载清理那条路径就会开始处理一个永远不会被卸载的东西。
       */
      if (target.kind === 'builtin') {
        builtinEnabled.write(enabled)
        republish()

        return
      }

      patchPreference(target.pluginId, (preference) => ({
        ...preference,
        disabledMcpServers: enabled
          ? preference.disabledMcpServers.filter((name) => name !== server)
          : [...preference.disabledMcpServers, server],
      }))
    },

    /*
     * 卸载 = 目录不在了。
     *
     * 上游卸载只删记录、留着托管副本；而在这一版里「装着」的定义就是目录在，所以
     * 只删记录等于什么都没删。先让磁盘对齐，再抹掉偏好里那一条 —— 顺序不能反：先
     * 删偏好再删目录，中间崩一次，这个插件会以默认开着的状态重新出现。
     */
    remove(pluginId) {
      queue = queue.then(async () => {
        /*
         * prunePlugins 的语义是「留下这些目录，其余全删」，比的是目录名。此前这份
         * 名单用清单名拼，任何目录名与清单名不同的插件都不在名单里 —— 卸载一个会
         * 顺手把它删掉。
         */
        const keep = snapshot.plugins
          .map((plugin) => plugin.pluginId)
          .filter((id) => id !== pluginId)

        try {
          await prunePlugins(keep)
        } catch (cause: unknown) {
          warn('插件目录没能删掉，界面因此不动', { scope: 'plugins', cause })

          return
        }

        const next = new Map(preferences)

        next.delete(pluginId)
        commitPreferences(next, '插件已经删掉了，偏好里那一条没抹干净', rescan)
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
          warn('暂存目录没能清掉', { scope: 'plugins', cause })
        }
      })
    },

    refreshMarketplace: fetchCatalog,
  }

  /*
   * 认领：把暂存目录搬进 plugins/<id>/，然后才记偏好。
   *
   * 顺序不能反。目录在了但偏好没写成，最坏是这个插件按默认档显示（开着、来历不明）；
   * 反过来先写偏好再搬目录，中间失败就会留下一条指向空气的记录 —— 而在这一版里
   * 「装着」的定义是目录在，那条记录连让人看见都做不到。
   */
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

      const next = new Map(preferences)

      next.set(pluginId, {
        enabled: true,
        disabledMcpServers: [],
        source,
        trust,
        installedAt: options.now(),
      })

      commitPreferences(next, '插件装好了，偏好没写进去，下次打开会按默认档显示', rescan)
    })
  }

  /*
   * 背书来自目录，不来自安装动作本身。
   *
   * 比的是描述串不是对象引用：目录条目里的来源和这次安装用的来源是两个结构相同、
   * 引用不同的对象，用 === 比永远不等，所有安装都会掉进 third-party。
   */
  function trustOf(source: PluginInstallSource): PluginTrustTier {
    const catalog = latestCatalog(snapshot.marketplace)

    if (catalog === undefined) {
      return UNLISTED_TRUST
    }

    const described = describeInstallSource(source)

    return (
      catalog.entries.find((entry) => describeInstallSource(entry.source) === described)?.trust ??
      UNLISTED_TRUST
    )
  }
}

/*
 * 清单读不出来的目录仍然是一个装着的插件：它得在界面上占一行，好让人看见原因。
 * 把它从列表里抹掉，人只会看到「我明明装了它却不见了」。
 */
function unreadableManifest(name: string): PluginManifest {
  return {
    name,
    displayName: name,
    description: undefined,
    version: undefined,
    developerName: undefined,
    homepage: undefined,
    capabilities: [],
    skillRoots: [],
    agentRoots: [],
    commandRoots: [],
    mcpServers: [],
    sessionStartSkill: undefined,
    skillInstructions: undefined,
    promptSources: [],
  }
}

function decodeManifestJson(pluginId: string, contents: string) {
  try {
    return decodePluginManifest(JSON.parse(contents))
  } catch (cause: unknown) {
    const diagnostics: PluginDiagnostic[] = [
      {
        code: 'manifest-invalid',
        pluginId,
        detail: cause instanceof Error ? cause.message : String(cause),
      },
    ]

    return { kind: 'rejected' as const, diagnostics }
  }
}
