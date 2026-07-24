import { applyThemePreference } from '@hybrid-canvas/design-system'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '../domain/settings'
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
  readonly dirty: boolean
  readonly operation: SettingsOperation | undefined
  readonly error: string | undefined
  readonly update: (updater: (settings: AppSettings) => AppSettings) => void
  readonly save: () => void
  readonly reset: () => void
  readonly retry: () => void
  readonly requestClose: () => void
}

interface UseSettingsControllerOptions {
  readonly open: boolean
  readonly store: SettingsStore
  readonly onOpenChange: (open: boolean) => void
}

export function useSettingsController({
  open,
  store,
  onOpenChange,
}: UseSettingsControllerOptions): SettingsController {
  const [state, setState] = useState<SettingsControllerState>({
    status: 'idle',
  })

  const baselineRef = useRef<AppSettings | null>(null)
  const requestVersionRef = useRef(0)
  const stateRef = useRef(state)

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

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1

      const baseline = baselineRef.current
      if (baseline) {
        applyThemePreference(baseline.theme)
      }

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

  const save = useCallback(() => {
    const current = stateRef.current

    if (!current.draft || current.status === 'saving') {
      return
    }

    const settingsToSave = current.draft
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion

    setState({
      status: 'saving',
      operation: 'save',
      draft: settingsToSave,
    })

    void store.save(settingsToSave).then(
      () => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        baselineRef.current = settingsToSave
        applyThemePreference(settingsToSave.theme)

        setState({
          status: 'ready',
          draft: settingsToSave,
        })

        onOpenChange(false)
      },
      (cause: unknown) => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        setState({
          status: 'error',
          operation: 'save',
          message: getErrorMessage(cause),
          draft: settingsToSave,
        })
      },
    )
  }, [onOpenChange, store])

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

    save()
  }, [beginLoad, reset, save])

  const requestClose = useCallback(() => {
    const current = stateRef.current

    if (current.status === 'saving') {
      return
    }

    requestVersionRef.current += 1

    const baseline = baselineRef.current
    if (baseline) {
      applyThemePreference(baseline.theme)
    }

    onOpenChange(false)
  }, [onOpenChange])

  const dirty = useMemo(() => {
    if (!state.draft || !baselineRef.current) {
      return false
    }

    return !settingsEqual(state.draft, baselineRef.current)
  }, [state.draft])

  return {
    settings: state.draft,
    loading: state.status === 'idle' || state.status === 'loading',
    saving: state.status === 'saving',
    dirty,
    operation: state.operation,
    error: state.status === 'error' ? state.message : undefined,
    update,
    save,
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
