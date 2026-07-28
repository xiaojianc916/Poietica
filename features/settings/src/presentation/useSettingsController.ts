import type { AppSettings } from '@poietica/agent-timeline'
import { applyThemePreference } from '@poietica/foundations-design-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SettingsStore } from '../ports/settings-store'

export type SettingsOperation = 'load' | 'save' | 'reset'

interface SettingsControllerState {
  readonly status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  readonly draft?: AppSettings
  readonly operation?: SettingsOperation
  readonly message?: string
}

export interface SettingsController {
  readonly settings: AppSettings | undefined
  readonly loading: boolean
  readonly saving: boolean
  readonly operation: SettingsOperation | undefined
  readonly error: string | undefined
  readonly update: (updater: (settings: AppSettings) => AppSettings) => void
  readonly reset: () => void
  readonly retry: () => void
  readonly requestClose: () => void
}

interface UseSettingsControllerOptions {
  readonly open: boolean
  readonly store: SettingsStore
  readonly onOpenChange: (open: boolean) => void
}

const AUTO_SAVE_DELAY_MS = 350

export function useSettingsController({
  open,
  store,
  onOpenChange,
}: UseSettingsControllerOptions): SettingsController {
  const [state, setState] = useState<SettingsControllerState>({
    status: 'idle',
  })

  const stateRef = useRef(state)
  const baselineRef = useRef<AppSettings | null>(null)
  const requestVersionRef = useRef(0)

  stateRef.current = state

  const beginLoad = useCallback(() => {
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion

    setState({
      status: 'loading',
      operation: 'load',
    })

    void store.load().then(
      (settings) => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        baselineRef.current = settings
        applyThemePreference(settings.theme)

        setState({
          status: 'ready',
          draft: settings,
        })
      },
      (cause: unknown) => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        setState({
          status: 'error',
          operation: 'load',
          message: getErrorMessage(cause),
        })
      },
    )
  }, [store])

  const persist = useCallback(
    (settings: AppSettings, closeAfterSave = false) => {
      const requestVersion = requestVersionRef.current + 1
      requestVersionRef.current = requestVersion

      setState({
        status: 'saving',
        operation: 'save',
        draft: settings,
      })

      void store.save(settings).then(
        () => {
          if (requestVersionRef.current !== requestVersion) {
            return
          }

          baselineRef.current = settings
          applyThemePreference(settings.theme)

          if (closeAfterSave) {
            setState({
              status: 'idle',
            })

            onOpenChange(false)
            return
          }

          setState({
            status: 'ready',
            draft: settings,
          })
        },
        (cause: unknown) => {
          if (requestVersionRef.current !== requestVersion) {
            return
          }

          setState({
            status: 'error',
            operation: 'save',
            message: getErrorMessage(cause),
            draft: settings,
          })
        },
      )
    },
    [onOpenChange, store],
  )

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1

      setState({
        status: 'idle',
      })

      return
    }

    beginLoad()

    return () => {
      requestVersionRef.current += 1
    }
  }, [beginLoad, open])

  /*
   * Automatically persist a stable draft.
   *
   * Only the small settings object is written. Canvas document state remains
   * owned by TLStore and is not involved in this process.
   */
  useEffect(() => {
    const baseline = baselineRef.current

    if (
      !open ||
      state.status !== 'ready' ||
      !state.draft ||
      !baseline ||
      settingsEqual(state.draft, baseline)
    ) {
      return
    }

    const draft = state.draft

    const timeout = window.setTimeout(() => {
      persist(draft)
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [open, persist, state.draft, state.status])

  const update = useCallback((updater: (settings: AppSettings) => AppSettings) => {
    setState((current) => {
      if (!current.draft || current.status === 'saving') {
        return current
      }

      const nextSettings = updater(current.draft)

      applyThemePreference(nextSettings.theme)

      return {
        status: 'ready',
        draft: nextSettings,
      }
    })
  }, [])

  const reset = useCallback(() => {
    const current = stateRef.current

    if (!current.draft || current.status === 'saving') {
      return
    }

    const currentDraft = current.draft
    const requestVersion = requestVersionRef.current + 1

    requestVersionRef.current = requestVersion

    setState({
      status: 'saving',
      operation: 'reset',
      draft: currentDraft,
    })

    void store.reset().then(
      (settings) => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        baselineRef.current = settings
        applyThemePreference(settings.theme)

        setState({
          status: 'ready',
          draft: settings,
        })
      },
      (cause: unknown) => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        setState({
          status: 'error',
          operation: 'reset',
          message: getErrorMessage(cause),
          draft: currentDraft,
        })
      },
    )
  }, [store])

  const retry = useCallback(() => {
    const current = stateRef.current

    if (current.status !== 'error') {
      return
    }

    if (current.operation === 'load') {
      beginLoad()
      return
    }

    if (current.operation === 'reset') {
      reset()
      return
    }

    if (current.draft) {
      persist(current.draft)
    }
  }, [beginLoad, persist, reset])

  const requestClose = useCallback(() => {
    const current = stateRef.current
    const baseline = baselineRef.current

    if (current.status === 'saving') {
      return
    }

    /*
     * If the debounce has not fired yet, flush the latest draft before
     * closing instead of silently discarding it.
     */
    if (current.draft && baseline && !settingsEqual(current.draft, baseline)) {
      persist(current.draft, true)
      return
    }

    requestVersionRef.current += 1

    setState({
      status: 'idle',
    })

    onOpenChange(false)
  }, [onOpenChange, persist])

  return {
    settings: state.draft,
    loading: state.status === 'idle' || state.status === 'loading',
    saving: state.status === 'saving',
    operation: state.operation,
    error: state.status === 'error' ? state.message : undefined,
    update,
    reset,
    retry,
    requestClose,
  }
}

function settingsEqual(left: AppSettings, right: AppSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message
  }

  return '设置操作失败，请重试。'
}
