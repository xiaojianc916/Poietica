import {
  commands,
  events,
  type UpdateProgress,
  type UpdateRelease,
} from '@poietica/ipc/generated/ipc-bindings'

export type {
  UpdateProgress,
  UpdateRelease,
} from '@poietica/ipc/generated/ipc-bindings'

export interface AppUpdateController {
  /** 有没有比当前版本更新的发布。没有则为 null。 */
  readonly check: () => Promise<UpdateRelease | null>
  /** 只下载，不安装。进度在下载期间回调，函数在下完时兑现。 */
  readonly download: (onProgress: (progress: UpdateProgress) => void) => Promise<void>
  /** 安装已下好的那一个并重启。正常路径上进程会在兑现之前就被接管。 */
  readonly relaunch: () => Promise<void>
}

/**
 * 更新的三步。
 *
 * 下载与安装刻意是两条命令而不是一条：`download_and_install` 在 Windows 的
 * passive 模式下会在下载完成的瞬间拉起安装器并杀掉当前进程，于是"下完了，等你
 * 点重启"这个状态根本不存在——用户会在进度条跑满的同一刻被强制关掉。
 *
 * 进度走生成的事件面。此前这里手抄了一份 'poietica://update-progress'，和
 * commands/updates.rs 里的常量各写一遍、靠人眼保持一致；payload 则由
 * listen<UpdateProgress>() 人肉断言，抄错不会有任何编译期反馈。现在事件名与
 * payload 类型都从 Rust 一次生成，改名即编译失败。
 */
export function createAppUpdateController(): AppUpdateController {
  return {
    check() {
      return commands.updateCheck()
    },

    async download(onProgress) {
      const stopListening = await events.updateProgress.listen((event) => {
        onProgress(event.payload)
      })

      try {
        await commands.updateDownload()
      } finally {
        stopListening()
      }
    },

    async relaunch() {
      /*
       * 命令的成功值在 Rust 那边是 ()，导出到 TypeScript 就是 null。这个 null
       * 不是契约的一部分，只是"没有返回值"的一种编码，所以在边界上吞掉，不让
       * 它渗进 AppUpdateController。
       */
      await commands.updateRelaunch()
    },
  }
}
