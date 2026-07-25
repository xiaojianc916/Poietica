import { error as reportError } from '@poietica/foundations-observability'
import type { ApplicationRuntime } from './application'
import type { MountedReactApplication } from './react-root'

export interface ApplicationLifecycle {
  readonly dispose: () => Promise<void>
}

export function installApplicationLifecycle(
  runtime: ApplicationRuntime,
  mounted: MountedReactApplication,
): ApplicationLifecycle {
  let disposed = false

  const dispose = async (): Promise<void> => {
    if (disposed) {
      return
    }

    disposed = true
    window.removeEventListener('pagehide', handlePageHide)
    window.removeEventListener('beforeunload', handleBeforeUnload)

    await mounted.unmount()
  }

  const handlePageHide = () => {
    void dispose().catch((cause: unknown) => {
      reportError('application disposal failed during pagehide', {
        scope: 'application-lifecycle',
        operation: 'dispose',
        cause,
      })
    })
  }

  const handleBeforeUnload = () => {
    void runtime.mainWindow.saveState().catch((cause: unknown) => {
      reportError('main window state save failed during unload', {
        scope: 'application-lifecycle',
        operation: 'save-window-state',
        cause,
      })
    })
  }

  window.addEventListener('pagehide', handlePageHide, {
    once: true,
  })
  window.addEventListener('beforeunload', handleBeforeUnload)

  return { dispose }
}
