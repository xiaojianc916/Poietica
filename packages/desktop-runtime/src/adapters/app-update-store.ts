import type { SettingsStore } from '@poietica/settings'
import type { AppUpdateController } from './app-update'

/* 与原生侧此前的 CHECK_EVERY 相同，节流只有这一份。 */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/* 启动后不立刻检查：首屏还在装配，一个网络往返没有理由和它抢。 */
const FIRST_CHECK_DELAY_MS = 30_000

export type AppUpdateState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'available'; readonly version: string }
  | {
      readonly phase: 'downloading'
      readonly version: string
      readonly percent: number | null
    }
  | { readonly phase: 'ready'; readonly version: string }

const IDLE: AppUpdateState = { phase: 'idle' }

/**
 * 更新这件事，一个进程一份。
 *
 * 它此前活在一个 React 组件的 useState 里，而那个组件挂在 sidebarFooterSlot 上 ——
 * WorkspaceContainer 把同一个插槽渲染在两个位置（常态的侧栏，和设置态的
 * sidebarOverride）。React 按位置协调，所以打开设置就是一次卸载 + 重新挂载：进度
 * 归零、定时器重建，几十秒后又从头提示一次"更新到 x.y.z"。人只能再点一次，而第一
 * 条下载还在后台跑。
 *
 * 一个下载任务的寿命是进程，不是某个插槽在当前布局下的可见性。它本来就不该住在
 * React 树里。形制与 ThreadsStore / workspaceLayoutStore 一致：不可变快照、
 * subscribe、没有真的变化就不通知；界面是只读投影，卸载重挂一个字都不丢。
 *
 * 检查节流也归这里：定时器跟着 store 活，六小时才真的是六小时。
 */
export class AppUpdateStore {
  readonly #controller: AppUpdateController

  readonly #settings: SettingsStore

  readonly #onFailure: (operation: string, cause: unknown) => void

  #state: AppUpdateState = IDLE

  #listeners = new Set<() => void>()

  /* 一次只跑一趟：重复点击是幂等的，原生侧也另有一道同样的闸。 */
  #downloading = false

  constructor(
    controller: AppUpdateController,
    settings: SettingsStore,
    onFailure: (operation: string, cause: unknown) => void,
  ) {
    this.#controller = controller
    this.#settings = settings
    this.#onFailure = onFailure
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): AppUpdateState => this.#state

  /**
   * 开始按节奏检查，交回停下来的办法。
   *
   * 订阅与退订成对交给调用方的 effect，与 ThreadsStore.start 同一条纪律：装载几次
   * 就订阅几次、退订几次，开发模式下的双次装载不会把它弄哑。
   */
  start = (): (() => void) => {
    /*
     * 开发构建不检查更新：开发跑的版本号来自工作区，任何已发布版本都比它新，
     * 结果是每六小时提示一次一个装不上的更新。
     */
    if (import.meta.env.DEV) {
      return () => {}
    }

    let active = true

    const check = async (): Promise<void> => {
      /* 已经现身、正在下载或已经下好时，不再问第二遍。 */
      if (!active || this.#state.phase !== 'idle') {
        return
      }

      const permitted = await this.#settings
        .load()
        .then((loaded) => loaded.privacy.updateCheck)
        .catch(() => false)

      if (!permitted || !active) {
        return
      }

      /*
       * 后台检查失败保持安静：离线是常态，为它报一次失败只是噪音。下载失败不同，
       * 那是人按下按钮之后的事，必须回话。
       */
      const release = await this.#controller.check().catch(() => null)

      if (!active || release === null) {
        return
      }

      this.#commit({ phase: 'available', version: release.version })
    }

    const first = window.setTimeout(() => {
      void check()
    }, FIRST_CHECK_DELAY_MS)

    const repeat = window.setInterval(() => {
      void check()
    }, CHECK_EVERY_MS)

    return () => {
      active = false
      window.clearTimeout(first)
      window.clearInterval(repeat)
    }
  }

  /** 开始下载。已经在下或已经下好时什么都不做。 */
  download = (): void => {
    const current = this.#state

    if (this.#downloading || current.phase !== 'available') {
      return
    }

    const version = current.version

    this.#downloading = true
    this.#commit({ phase: 'downloading', version, percent: null })

    void this.#controller
      .download((progress) => {
        this.#advance(version, progress.percent ?? null)
      })
      .then(
        () => {
          this.#downloading = false
          this.#commit({ phase: 'ready', version })
        },
        (cause: unknown) => {
          this.#downloading = false
          this.#onFailure('download-update', cause)

          /* 退回可点状态：这枚胶囊本身就是重试入口。 */
          this.#commit({ phase: 'available', version })
        },
      )
  }

  /** 装上并重启。正常路径上进程会在这之前就被接管。 */
  relaunch = (): void => {
    if (this.#state.phase !== 'ready') {
      return
    }

    void this.#controller.relaunch().catch((cause: unknown) => {
      this.#onFailure('install-update', cause)
    })
  }

  /*
   * 进度只许前进。
   *
   * 原生侧现在保证同一时刻只有一条下载，所以理论上不会再有回退；这一道是第二重
   * 保险，也是对"进度条"这三个字的字面承诺 —— 一根会往回缩的进度条比没有更糟。
   * 迟到的那一帧被吃掉，代价是零；放它过去，代价是人看着数字倒退。
   */
  #advance(version: string, percent: number | null): void {
    const current = this.#state

    if (current.phase !== 'downloading' || current.version !== version) {
      return
    }

    if (percent === null) {
      return
    }

    const next = current.percent === null ? percent : Math.max(current.percent, percent)

    if (next === current.percent) {
      return
    }

    this.#commit({ phase: 'downloading', version, percent: next })
  }

  #commit(next: AppUpdateState): void {
    this.#state = next

    for (const listener of this.#listeners) {
      listener()
    }
  }
}
