import {
  commands,
  type UpdateProgress,
  type UpdateRelease,
} from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

export type { UpdateProgress, UpdateRelease }

/** 与 src-tauri/src/commands/updates.rs 的 UPDATE_PROGRESS_EVENT 对应。 */
const UPDATE_PROGRESS_EVENT = 'poietica://update-progress'

export interface AppUpdateController {
  /** 没有可安装的新版本时返回 null。 */
  check(): Promise<UpdateRelease | null>
  /** 下载并安装。返回即意味着安装器已接手，应用随即重启。 */
  install(onProgress: (progress: UpdateProgress) => void): Promise<void>
}

/**
 * 更新能力的桌面实现。
 *
 * 走的是两条自有命令，而不是 @tauri-apps/plugin-updater 的 JS 面：后者要求
 * capabilities 里放行 updater:default，等于把检查、下载、安装那一整组 IPC 命令
 * 交给 webview。窄命令与 window_open_devtools 是同一个取舍。
 */
export function createAppUpdateController(): AppUpdateController {
  return {
    check: () => commands.updateCheck(),

    async install(onProgress) {
      const { listen } = await import('@tauri-apps/api/event')

      const stopListening = await listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (event) => {
        onProgress(event.payload)
      })

      try {
        await commands.updateInstall()
      } finally {
        stopListening()
      }
    },
  }
}
