import { invoke } from '@hybrid-canvas/desktop-ipc'

export interface MainWindowController {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  onResized(handler: () => void): Promise<() => void>
  openDeveloperTools(): Promise<void>
  close(): Promise<void>
  forceClose(): void
  onCloseRequested(handler: () => void): Promise<() => void>
  startDragging(): Promise<void>
  setTitle(title: string): Promise<void>
  saveState(): Promise<void>
}

const MAIN_WINDOW_LABEL = 'main'

async function getMainWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const window = getCurrentWindow()

  if (window.label !== MAIN_WINDOW_LABEL) {
    throw new Error(`Expected window "${MAIN_WINDOW_LABEL}", received "${window.label}".`)
  }

  return window
}

export function createMainWindowController(): MainWindowController {
  return {
    async minimize() {
      const window = await getMainWindow()
      await window.minimize()
    },
    async toggleMaximize() {
      const window = await getMainWindow()
      await window.toggleMaximize()
    },
    async isMaximized() {
      const window = await getMainWindow()
      return window.isMaximized()
    },
    async onResized(handler) {
      const window = await getMainWindow()

      return window.onResized(() => {
        handler()
      })
    },
    openDeveloperTools: () =>
      invoke('window_open_devtools', {
        label: MAIN_WINDOW_LABEL,
      }),
    close: () => invoke('window_close', { label: MAIN_WINDOW_LABEL }),
    forceClose() {
      // Application termination is intentionally fire-and-forget.
      // The renderer may be destroyed before an IPC response can return.
      void invoke<void>('window_destroy', {
        label: MAIN_WINDOW_LABEL,
      })
        .catch(async () => {
          // Native command dispatch failed before the window was destroyed.
          // Fall back to Tauri's direct window API.
          const { getCurrentWindow } = await import('@tauri-apps/api/window')

          await getCurrentWindow().destroy()
        })
        .catch(() => {
          // There is no useful renderer recovery UI for a failed process
          // termination. Do not surface an internal retry dialog.
        })
    },
    async onCloseRequested(handler) {
      const { isTauri } = await import('@tauri-apps/api/core')
      if (!isTauri()) {
        return () => {}
      }
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      return getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault()
        handler()
      })
    },
    async startDragging() {
      const window = await getMainWindow()
      await window.startDragging()
    },
    setTitle: (title) => invoke('window_set_title', { label: MAIN_WINDOW_LABEL, title }),
    saveState: () => invoke('window_save_state'),
  }
}
