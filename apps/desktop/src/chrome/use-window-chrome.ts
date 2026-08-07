import type { MainWindowController } from '@poietica/desktop-adapters'
import { useCallback, useEffect, useState } from 'react'
import { reportFailure } from '../failures/application-policy'

export interface WindowChrome {
  readonly isMaximized: boolean
  readonly minimize: () => void
  readonly toggleMaximize: () => void
}

/**
 * 窗口控制按钮需要的一切：当前是否最大化，以及两个动作。
 *
 * 关闭不在这里。正常界面的关闭要先过未保存确认，崩溃屏上那条流程所依赖的组件树
 * 已经不存在了——这是两种策略，不是同一个动作的两个参数，各自留在调用点。
 */
export function useWindowChrome(mainWindow: MainWindowController): WindowChrome {
  const isMaximized = useMaximizedState(mainWindow)

  const minimize = useCallback(() => {
    void mainWindow.minimize().catch((cause: unknown) => {
      reportFailure('WINDOW_MINIMIZE_UNAVAILABLE', {
        scope: 'window-chrome',
        operation: 'minimize-window',
        cause,
      })
    })
  }, [mainWindow])

  const toggleMaximize = useCallback(() => {
    void mainWindow.toggleMaximize().catch((cause: unknown) => {
      reportFailure('WINDOW_MAXIMIZE_UNAVAILABLE', {
        scope: 'window-chrome',
        operation: 'toggle-maximize-window',
        cause,
      })
    })
  }, [mainWindow])

  return { isMaximized, minimize, toggleMaximize }
}

function useMaximizedState(mainWindow: MainWindowController): boolean {
  const [isMaximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let requestVersion = 0

    function synchronizeMaximizedState() {
      const currentVersion = ++requestVersion

      void mainWindow.isMaximized().then(
        (nextIsMaximized) => {
          if (!active || currentVersion !== requestVersion) {
            return
          }

          setMaximized(nextIsMaximized)
        },
        (cause: unknown) => {
          if (!active) {
            return
          }

          reportFailure('WINDOW_STATE_QUERY_UNAVAILABLE', {
            scope: 'window-chrome',
            operation: 'query-window-maximized',
            cause,
          })
        },
      )
    }

    synchronizeMaximizedState()

    void mainWindow.onResized(synchronizeMaximizedState).then(
      (nextUnsubscribe) => {
        if (!active) {
          nextUnsubscribe()
          return
        }

        unsubscribe = nextUnsubscribe
      },
      (cause: unknown) => {
        if (!active) {
          return
        }

        reportFailure('WINDOW_RESIZE_SYNC_UNAVAILABLE', {
          scope: 'window-chrome',
          operation: 'register-window-resize-listener',
          cause,
        })
      },
    )

    return () => {
      active = false
      requestVersion += 1
      unsubscribe?.()
    }
  }, [mainWindow])

  return isMaximized
}
