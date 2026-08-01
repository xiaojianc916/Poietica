import { commands } from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

export type {
  UpdateProgress,
  UpdateRelease,
} from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

import type {
  UpdateProgress,
  UpdateRelease,
} from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

/* 与原生侧 commands/updates.rs 的 UPDATE_PROGRESS_EVENT 同名同值。 */
const UPDATE_PROGRESS_EVENT = 'poietica://update-progress'

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
 * 事件监听按 native-window.ts 的既有做法动态引入 @tauri-apps/api/event：这个包
 * 在 web 构建里不该被静态求值。
 */
export function createAppUpdateController(): AppUpdateController {
  return {
    check() {
      return commands.updateCheck()
    },

    async download(onProgress) {
      const { listen } = await import('@tauri-apps/api/event')

      const stopListening = await listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (event) => {
        onProgress(event.payload)
      })

      try {
        await commands.updateDownload()
      } finally {
        stopListening()
      }
    },

    relaunch() {
      return commands.updateRelaunch()
    },
  }
}
