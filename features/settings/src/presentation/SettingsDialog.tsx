import {
  applyThemePreference,
  Button,
  Dialog,
  ErrorState,
  Field,
  Label,
  LoadingState,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  type SelectOption,
  SelectTrigger,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@hybrid-canvas/design-system'
import type { AppSettings, SettingsStore, ThemeMode } from '@hybrid-canvas/settings'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

type SettingsSection = 'general' | 'canvas' | 'about'

type SettingsOperation = 'load' | 'save' | 'reset'

type SettingsViewState =
  | {
      readonly status: 'idle'
    }
  | {
      readonly status: 'loading'
    }
  | {
      readonly status: 'ready'
      readonly draft: AppSettings
    }
  | {
      readonly status: 'saving'
      readonly operation: 'save' | 'reset'
      readonly draft: AppSettings
    }
  | {
      readonly status: 'error'
      readonly operation: SettingsOperation
      readonly message: string
      readonly draft?: AppSettings
    }

interface SettingsSectionItem {
  readonly id: SettingsSection
  readonly label: string
}

const SECTIONS: readonly SettingsSectionItem[] = [
  {
    id: 'general',
    label: '常规',
  },
  {
    id: 'canvas',
    label: '画布',
  },
  {
    id: 'about',
    label: '关于',
  },
]

const THEME_OPTIONS: readonly SelectOption[] = [
  {
    value: 'light',
    label: '浅色',
  },
  {
    value: 'dark',
    label: '深色',
  },
  {
    value: 'system',
    label: '跟随系统',
  },
]

const LANGUAGE_OPTIONS: readonly SelectOption[] = [
  {
    value: 'zh-CN',
    label: '简体中文',
  },
  {
    value: 'en',
    label: 'English',
  },
]

const ZOOM_OPTIONS: readonly SelectOption[] = [
  {
    value: '1',
    label: '100%',
  },
  {
    value: '0.75',
    label: '75%',
  },
  {
    value: '0.5',
    label: '50%',
  },
]

export interface SettingsDialogProps {
  readonly open: boolean
  readonly store: SettingsStore
  readonly onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, store, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>('general')

  const [state, setState] = useState<SettingsViewState>({
    status: 'idle',
  })

  const initialSettingsRef = useRef<AppSettings | null>(null)

  const requestIdRef = useRef(0)

  const loadSettings = useCallback(() => {
    const requestId = requestIdRef.current + 1

    requestIdRef.current = requestId

    setState({
      status: 'loading',
    })

    void store.load().then(
      (settings) => {
        if (requestIdRef.current !== requestId) {
          return
        }

        initialSettingsRef.current = settings

        applyThemePreference(settings.theme)

        setState({
          status: 'ready',
          draft: settings,
        })
      },
      (cause: unknown) => {
        if (requestIdRef.current !== requestId) {
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
      requestIdRef.current += 1
      return
    }

    setSection('general')
    loadSettings()

    return () => {
      requestIdRef.current += 1
    }
  }, [loadSettings, open])

  const draft = getDraft(state)

  const busy = state.status === 'saving'

  const updateDraft = (nextSettings: AppSettings) => {
    if (busy) {
      return
    }

    applyThemePreference(nextSettings.theme)

    setState({
      status: 'ready',
      draft: nextSettings,
    })
  }

  const closeDialog = () => {
    if (busy) {
      return
    }

    const initialSettings = initialSettingsRef.current

    if (initialSettings) {
      applyThemePreference(initialSettings.theme)
    }

    onOpenChange(false)
  }

  const saveSettings = () => {
    if (!draft || busy) {
      return
    }

    const settingsToSave = draft

    setState({
      status: 'saving',
      operation: 'save',
      draft: settingsToSave,
    })

    void store.save(settingsToSave).then(
      () => {
        initialSettingsRef.current = settingsToSave

        applyThemePreference(settingsToSave.theme)

        setState({
          status: 'ready',
          draft: settingsToSave,
        })

        onOpenChange(false)
      },
      (cause: unknown) => {
        setState({
          status: 'error',
          operation: 'save',
          message: getErrorMessage(cause),
          draft: settingsToSave,
        })
      },
    )
  }

  const resetSettings = () => {
    if (!draft || busy) {
      return
    }

    const currentDraft = draft

    setState({
      status: 'saving',
      operation: 'reset',
      draft: currentDraft,
    })

    void store.reset().then(
      (resetSettingsValue) => {
        initialSettingsRef.current = resetSettingsValue

        applyThemePreference(resetSettingsValue.theme)

        setState({
          status: 'ready',
          draft: resetSettingsValue,
        })
      },
      (cause: unknown) => {
        setState({
          status: 'error',
          operation: 'reset',
          message: getErrorMessage(cause),
          draft: currentDraft,
        })
      },
    )
  }

  const retryLastOperation = () => {
    if (state.status !== 'error') {
      return
    }

    if (state.operation === 'load') {
      loadSettings()
      return
    }

    if (state.operation === 'save') {
      saveSettings()
      return
    }

    resetSettings()
  }

  return (
    <Dialog
      busy={busy}
      className={[
        'h-[min(680px,calc(100dvh-2rem))]',
        'max-w-[920px]',
        'max-sm:h-dvh',
        'max-sm:max-h-dvh',
        'max-sm:rounded-none',
      ].join(' ')}
      closeOnOverlayClick={!busy}
      description="调整 Hybrid Canvas 的使用体验"
      footer={
        <SettingsFooter
          busy={busy}
          canReset={Boolean(draft)}
          canSave={Boolean(draft)}
          onCancel={closeDialog}
          onReset={resetSettings}
          onSave={saveSettings}
          operation={state.status === 'saving' ? state.operation : undefined}
        />
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog()
        }
      }}
      open={open}
      title="设置"
    >
      <Tabs
        className={[
          'grid h-full min-h-0',
          'grid-cols-[224px_minmax(0,1fr)]',
          'max-sm:grid-cols-1',
          'max-sm:grid-rows-[auto_minmax(0,1fr)]',
        ].join(' ')}
        onValueChange={(nextSection) => {
          setSection(nextSection as SettingsSection)
        }}
        value={section}
      >
        <SettingsNavigation />

        <main className={['min-h-0 overflow-y-auto', 'p-6 max-sm:p-4'].join(' ')}>
          {state.status === 'idle' || state.status === 'loading' ? (
            <LoadingState label="正在读取设置…" />
          ) : null}

          {state.status === 'error' && !state.draft ? (
            <ErrorState message={state.message} onRetry={retryLastOperation} />
          ) : null}

          {state.status === 'error' && state.draft ? (
            <SettingsErrorBanner
              message={state.message}
              onRetry={retryLastOperation}
              operation={state.operation}
            />
          ) : null}

          {draft ? (
            <TabsContent className="m-0 outline-none focus-visible:ring-0" value="general">
              <GeneralSettingsPanel onChange={updateDraft} settings={draft} />
            </TabsContent>
          ) : null}

          {draft ? (
            <TabsContent className="m-0 outline-none focus-visible:ring-0" value="canvas">
              <CanvasSettingsPanel onChange={updateDraft} settings={draft} />
            </TabsContent>
          ) : null}

          <TabsContent className="m-0 outline-none focus-visible:ring-0" value="about">
            <AboutSettingsPanel />
          </TabsContent>
        </main>
      </Tabs>
    </Dialog>
  )
}

function SettingsNavigation() {
  return (
    <TabsList
      aria-label="设置分类"
      className={[
        'h-auto min-h-0',
        'w-full',
        'flex-col items-stretch',
        'justify-start',
        'gap-1 rounded-none',
        'border-r border-divider',
        'bg-muted/30 p-4',
        'max-sm:flex-row',
        'max-sm:overflow-x-auto',
        'max-sm:border-b',
        'max-sm:border-r-0',
        'max-sm:p-2',
      ].join(' ')}
    >
      {SECTIONS.map((item) => (
        <TabsTrigger
          className={[
            'w-full justify-start',
            'px-3 py-2',
            'text-left text-sm',
            'shadow-none',
            'data-[active]:bg-accent',
            'data-[active]:text-accent-foreground',
            'data-[active]:shadow-none',
            'max-sm:w-auto',
            'max-sm:shrink-0',
          ].join(' ')}
          key={item.id}
          value={item.id}
        >
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

interface SettingsPanelProps {
  readonly settings: AppSettings
  readonly onChange: (settings: AppSettings) => void
}

function GeneralSettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <section aria-labelledby="general-settings-title" className="grid max-w-xl gap-8">
      <header>
        <h3 className="text-base font-semibold" id="general-settings-title">
          常规
        </h3>

        <p className={['mt-1 text-sm', 'text-muted-foreground'].join(' ')}>
          调整应用外观、语言和保存行为。
        </p>
      </header>

      <Field description="选择应用界面的颜色模式。" label="外观">
        {({ inputId, describedBy }) => (
          <SettingsSelect
            ariaDescribedBy={describedBy}
            data={THEME_OPTIONS}
            id={inputId}
            onValueChange={(value) => {
              onChange({
                ...settings,
                theme: value as ThemeMode,
              })
            }}
            type="外观"
            value={settings.theme}
          />
        )}
      </Field>

      <Field description="控制应用界面使用的语言。" label="语言">
        {({ inputId, describedBy }) => (
          <SettingsSelect
            ariaDescribedBy={describedBy}
            data={LANGUAGE_OPTIONS}
            id={inputId}
            onValueChange={(value) => {
              onChange({
                ...settings,
                language: value as AppSettings['language'],
              })
            }}
            type="语言"
            value={settings.language}
          />
        )}
      </Field>

      <SettingsToggle
        checked={settings.autoSave}
        description="编辑画布时自动保存到当前文件。"
        label="自动保存"
        onChange={(checked) => {
          onChange({
            ...settings,
            autoSave: checked,
          })
        }}
      />
    </section>
  )
}

function CanvasSettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <section aria-labelledby="canvas-settings-title" className="grid max-w-xl gap-6">
      <header>
        <h3 className="text-base font-semibold" id="canvas-settings-title">
          画布
        </h3>

        <p className={['mt-1 text-sm', 'text-muted-foreground'].join(' ')}>
          调整网格、吸附和默认缩放。
        </p>
      </header>

      <SettingsToggle
        checked={settings.canvas.showGrid}
        description="在画布背景中显示辅助网格。"
        label="显示网格"
        onChange={(checked) => {
          onChange({
            ...settings,
            canvas: {
              ...settings.canvas,
              showGrid: checked,
            },
          })
        }}
      />

      <SettingsToggle
        checked={settings.canvas.snapToGrid}
        description="移动图形时自动吸附到网格。"
        label="吸附到网格"
        onChange={(checked) => {
          onChange({
            ...settings,
            canvas: {
              ...settings.canvas,
              snapToGrid: checked,
            },
          })
        }}
      />

      <Field description="新建画布时使用的默认缩放比例。" label="默认缩放">
        {({ inputId, describedBy }) => (
          <SettingsSelect
            ariaDescribedBy={describedBy}
            data={ZOOM_OPTIONS}
            id={inputId}
            onValueChange={(value) => {
              onChange({
                ...settings,
                canvas: {
                  ...settings.canvas,
                  defaultZoom: Number(value),
                },
              })
            }}
            type="缩放比例"
            value={String(settings.canvas.defaultZoom)}
          />
        )}
      </Field>
    </section>
  )
}

interface SettingsSelectProps {
  readonly id: string
  readonly ariaDescribedBy: string | undefined
  readonly data: readonly SelectOption[]
  readonly type: string
  readonly value: string
  readonly onValueChange: (value: string) => void
}

function SettingsSelect({
  id,
  ariaDescribedBy,
  data,
  type,
  value,
  onValueChange,
}: SettingsSelectProps) {
  const [open, setOpen] = useState(false)

  return (
    <Select
      data={data}
      onOpenChange={setOpen}
      onValueChange={onValueChange}
      open={open}
      type={type}
      value={value}
    >
      <SelectTrigger aria-describedby={ariaDescribedBy} id={id} />

      <SelectContent>
        <SelectList>
          <SelectGroup>
            {data.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectList>
      </SelectContent>
    </Select>
  )
}

interface SettingsToggleProps {
  readonly checked: boolean
  readonly label: string
  readonly description: string
  readonly onChange: (checked: boolean) => void
}

function SettingsToggle({ checked, label, description, onChange }: SettingsToggleProps) {
  const descriptionId = useId()

  return (
    <div className={['grid min-h-14 gap-2', 'border-b border-divider', 'py-3'].join(' ')}>
      <Label className="flex w-fit cursor-pointer items-center gap-2">
        <Switch aria-describedby={descriptionId} checked={checked} onCheckedChange={onChange} />

        <span>{label}</span>
      </Label>

      <p
        className={['pl-11 text-xs leading-5', 'text-muted-foreground'].join(' ')}
        id={descriptionId}
      >
        {description}
      </p>
    </div>
  )
}

function AboutSettingsPanel() {
  return (
    <section
      aria-labelledby="about-settings-title"
      className={['max-w-xl rounded-lg', 'border border-divider', 'p-5'].join(' ')}
    >
      <h3 className="text-base font-semibold" id="about-settings-title">
        Hybrid Canvas
      </h3>

      <p className={['mt-2 text-sm', 'text-muted-foreground'].join(' ')}>
        基于 tldraw 的本地优先画布应用。
      </p>

      <dl className={['mt-5 grid', 'grid-cols-[100px_1fr]', 'gap-y-2 text-sm'].join(' ')}>
        <dt className="text-muted-foreground">版本</dt>

        <dd>0.1.0</dd>

        <dt className="text-muted-foreground">设置存储</dt>

        <dd>Tauri Store</dd>
      </dl>
    </section>
  )
}

interface SettingsFooterProps {
  readonly busy: boolean
  readonly canSave: boolean
  readonly canReset: boolean
  readonly operation: 'save' | 'reset' | undefined
  readonly onSave: () => void
  readonly onReset: () => void
  readonly onCancel: () => void
}

function SettingsFooter({
  busy,
  canSave,
  canReset,
  operation,
  onSave,
  onReset,
  onCancel,
}: SettingsFooterProps) {
  return (
    <div className={['flex flex-wrap', 'items-center', 'justify-between', 'gap-3'].join(' ')}>
      <Button disabled={busy || !canReset} onClick={onReset} type="button" variant="ghost">
        {busy && operation === 'reset' ? '正在重置…' : '恢复默认'}
      </Button>

      <div className="flex gap-2">
        <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
          取消
        </Button>

        <Button disabled={busy || !canSave} onClick={onSave} type="button">
          {busy && operation === 'save' ? '正在保存…' : '保存'}
        </Button>
      </div>
    </div>
  )
}

interface SettingsErrorBannerProps {
  readonly operation: SettingsOperation
  readonly message: string
  readonly onRetry: () => void
}

function SettingsErrorBanner({ operation, message, onRetry }: SettingsErrorBannerProps) {
  return (
    <div
      className={[
        'mb-5 rounded-md',
        'border',
        'border-destructive/30',
        'bg-destructive/10',
        'p-3',
      ].join(' ')}
      role="alert"
    >
      <p className={['text-sm', 'text-destructive'].join(' ')}>
        {getOperationLabel(operation)}：{message}
      </p>

      <Button className="mt-3" onClick={onRetry} size="sm" type="button" variant="outline">
        重试
      </Button>
    </div>
  )
}

function getDraft(state: SettingsViewState): AppSettings | undefined {
  if ('draft' in state) {
    return state.draft
  }

  return undefined
}

function getOperationLabel(operation: SettingsOperation): string {
  if (operation === 'load') {
    return '读取设置失败'
  }

  if (operation === 'save') {
    return '保存设置失败'
  }

  return '重置设置失败'
}

function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message
  }

  return '设置操作失败，请重试。'
}
