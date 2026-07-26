import {
  Button,
  Dialog,
  ErrorState,
  LoadingState,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  type SelectOption,
  SelectTrigger,
  Switch,
} from '@poietica/foundations-design-system'
import { memo, type ReactNode, useCallback, useState } from 'react'
import type { AppSettings } from '../domain/settings'
import type { SettingsStore } from '../ports/settings-store'
import {
  type SettingsController,
  type SettingsOperation,
  useSettingsController,
} from './useSettingsController'
import './settings-dialog.css'

type SettingsSection = 'general' | 'canvas' | 'export' | 'privacy' | 'about'

interface SectionDefinition {
  readonly id: SettingsSection
  readonly label: string
}

const SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'general',
    label: '常规',
  },
  {
    id: 'canvas',
    label: '画布',
  },
  {
    id: 'export',
    label: '导出',
  },
  {
    id: 'privacy',
    label: '隐私',
  },
  {
    id: 'about',
    label: '关于',
  },
]

export interface SettingsDialogProps {
  readonly open: boolean
  readonly store: SettingsStore
  readonly onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, store, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>('general')

  const controller = useSettingsController({
    open,
    store,
    onOpenChange,
  })

  const selectSection = useCallback((nextSection: SettingsSection) => {
    setSection(nextSection)
  }, [])

  return (
    <Dialog
      busy={controller.saving}
      className="settings-dialog"
      closeOnOverlayClick={!controller.saving}
      contentClassName="settings-dialog__viewport"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          controller.requestClose()
        }
      }}
      open={open}
      showHeader={false}
      title="设置"
    >
      <div className="settings-shell">
        <SettingsNavigation activeSection={section} onSelect={selectSection} />

        <main aria-live="polite" className="settings-content">
          {controller.loading ? (
            <div className="settings-state">
              <LoadingState label="正在读取本地设置…" />
            </div>
          ) : null}

          {!controller.loading && controller.error && !controller.settings ? (
            <div className="settings-state">
              <ErrorState message={controller.error} onRetry={controller.retry} />
            </div>
          ) : null}

          {controller.settings ? (
            <>
              {controller.error ? (
                <SettingsErrorBanner
                  message={controller.error}
                  onRetry={controller.retry}
                  operation={controller.operation}
                />
              ) : null}

              <SettingsSectionContent
                controller={controller}
                section={section}
                settings={controller.settings}
              />
            </>
          ) : null}
        </main>
      </div>
    </Dialog>
  )
}

interface SettingsNavigationProps {
  readonly activeSection: SettingsSection
  readonly onSelect: (section: SettingsSection) => void
}

const SettingsNavigation = memo(function SettingsNavigation({
  activeSection,
  onSelect,
}: SettingsNavigationProps) {
  return (
    <aside aria-label="设置分类" className="settings-navigation">
      <nav className="settings-navigation__items">
        {SECTIONS.map((item) => {
          const active = item.id === activeSection

          return (
            <button
              aria-current={active ? 'page' : undefined}
              className="settings-navigation__item"
              data-active={active ? 'true' : 'false'}
              key={item.id}
              onClick={() => {
                onSelect(item.id)
              }}
              type="button"
            >
              <SectionIcon section={item.id} />

              <span className="settings-navigation__copy">
                <strong>{item.label}</strong>
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
})

interface SettingsSectionContentProps {
  readonly section: SettingsSection
  readonly settings: AppSettings
  readonly controller: SettingsController
}

function SettingsSectionContent({ section, settings, controller }: SettingsSectionContentProps) {
  switch (section) {
    case 'general':
      return <GeneralSettings controller={controller} settings={settings} />

    case 'canvas':
      return <CanvasSettings controller={controller} settings={settings} />

    case 'export':
      return <ExportSettings controller={controller} settings={settings} />

    case 'privacy':
      return <PrivacySettings controller={controller} settings={settings} />

    case 'about':
      return <AboutSettings />
  }
}

interface SettingsPanelProps {
  readonly settings: AppSettings
  readonly controller: SettingsController
}

const GeneralSettings = memo(function GeneralSettings({
  settings,
  controller,
}: SettingsPanelProps) {
  return (
    <SettingsPage>
      <SettingsGroup title="外观">
        <SettingRow label="颜色模式">
          <SettingsSelect
            ariaLabel="颜色模式"
            onChange={(theme) => {
              controller.update((current) => ({
                ...current,
                theme,
              }))
            }}
            options={[
              ['light', '浅色'],
              ['dark', '深色'],
              ['system', '跟随系统'],
            ]}
            value={settings.theme}
          />
        </SettingRow>

        <SettingRow label="界面语言">
          <SettingsSelect
            ariaLabel="界面语言"
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                language: value,
              }))
            }}
            options={[
              ['zh-CN', '简体中文'],
              ['en', 'English'],
            ]}
            value={settings.language}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="保存">
        <ToggleRow
          checked={settings.autoSave}
          label="自动保存"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              autoSave: checked,
            }))
          }}
        />

        {settings.autoSave ? (
          <SettingRow label="保存间隔">
            <SettingsSelect
              ariaLabel="自动保存间隔"
              onChange={(value) => {
                controller.update((current) => ({
                  ...current,
                  autoSaveIntervalMs: Number(value),
                }))
              }}
              options={[
                ['10000', '10 秒'],
                ['30000', '30 秒'],
                ['60000', '1 分钟'],
                ['300000', '5 分钟'],
              ]}
              value={String(settings.autoSaveIntervalMs)}
            />
          </SettingRow>
        ) : null}

        <SettingRow label="恢复默认设置">
          <Button
            disabled={controller.saving}
            onClick={controller.reset}
            type="button"
            variant="outline"
          >
            {controller.saving && controller.operation === 'reset' ? '正在恢复…' : '恢复默认'}
          </Button>
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
})

const CanvasSettings = memo(function CanvasSettings({ settings, controller }: SettingsPanelProps) {
  return (
    <SettingsPage>
      <SettingsGroup title="视图">
        <ToggleRow
          checked={settings.canvas.infiniteCanvas}
          label="无限画布"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              canvas: {
                ...current.canvas,
                infiniteCanvas: checked,
              },
            }))
          }}
        />

        <ToggleRow
          checked={settings.canvas.showRulers}
          label="显示标尺"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              canvas: {
                ...current.canvas,
                showRulers: checked,
              },
            }))
          }}
        />

        <SettingRow label="默认缩放">
          <SettingsSelect
            ariaLabel="默认画布缩放"
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                canvas: {
                  ...current.canvas,
                  defaultZoom: Number(value),
                },
              }))
            }}
            options={[
              ['0.5', '50%'],
              ['0.75', '75%'],
              ['1', '100%'],
              ['1.25', '125%'],
            ]}
            value={String(settings.canvas.defaultZoom)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="网格与吸附">
        <ToggleRow
          checked={settings.canvas.showGrid}
          label="显示网格"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              canvas: {
                ...current.canvas,
                showGrid: checked,
              },
            }))
          }}
        />

        <ToggleRow
          checked={settings.canvas.snapToGrid}
          label="吸附到网格"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              canvas: {
                ...current.canvas,
                snapToGrid: checked,
              },
            }))
          }}
        />

        <SettingRow label="网格尺寸">
          <SettingsSelect
            ariaLabel="画布网格尺寸"
            disabled={!settings.canvas.showGrid && !settings.canvas.snapToGrid}
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                canvas: {
                  ...current.canvas,
                  gridSize: Number(value),
                },
              }))
            }}
            options={[
              ['8', '8 px'],
              ['12', '12 px'],
              ['16', '16 px'],
              ['20', '20 px'],
              ['24', '24 px'],
              ['32', '32 px'],
            ]}
            value={String(settings.canvas.gridSize)}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
})

const ExportSettings = memo(function ExportSettings({ settings, controller }: SettingsPanelProps) {
  return (
    <SettingsPage>
      <SettingsGroup title="默认输出">
        <SettingRow label="文件格式">
          <SettingsSelect
            ariaLabel="默认导出格式"
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                export: {
                  ...current.export,
                  defaultFormat: value,
                },
              }))
            }}
            options={[
              ['svg', 'SVG · 矢量'],
              ['png', 'PNG · 图片'],
              ['pdf', 'PDF · 文档'],
            ]}
            value={settings.export.defaultFormat}
          />
        </SettingRow>

        <SettingRow label="PNG 清晰度">
          <SettingsSelect
            ariaLabel="PNG 导出清晰度"
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                export: {
                  ...current.export,
                  pngDpi: Number(value),
                },
              }))
            }}
            options={[
              ['72', '72 DPI'],
              ['144', '144 DPI'],
              ['300', '300 DPI'],
              ['600', '600 DPI'],
            ]}
            value={String(settings.export.pngDpi)}
          />
        </SettingRow>

        <SettingRow label="PDF 质量">
          <SettingsSelect
            ariaLabel="PDF 导出质量"
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                export: {
                  ...current.export,
                  pdfQuality: Number(value),
                },
              }))
            }}
            options={[
              ['50', '50% · 较小文件'],
              ['70', '70% · 标准'],
              ['80', '80% · 清晰'],
              ['90', '90% · 高质量'],
              ['100', '100% · 最高质量'],
            ]}
            value={String(settings.export.pdfQuality)}
          />
        </SettingRow>

        <ToggleRow
          checked={settings.export.includeMetadata}
          label="包含元数据"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              export: {
                ...current.export,
                includeMetadata: checked,
              },
            }))
          }}
        />
      </SettingsGroup>
    </SettingsPage>
  )
})

const PrivacySettings = memo(function PrivacySettings({
  settings,
  controller,
}: SettingsPanelProps) {
  return (
    <SettingsPage>
      <div className="settings-privacy-note">
        <span aria-hidden="true" className="settings-privacy-note__icon">
          ✓
        </span>

        <div>
          <strong>你的画布默认保留在设备上</strong>
          <p>文档内容不会因为启用诊断或更新检查而自动上传。</p>
        </div>
      </div>

      <SettingsGroup title="诊断与更新">
        <ToggleRow
          checked={settings.privacy.telemetry}
          label="匿名使用数据"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              privacy: {
                ...current.privacy,
                telemetry: checked,
              },
            }))
          }}
        />

        <ToggleRow
          checked={settings.privacy.crashReporting}
          label="崩溃报告"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              privacy: {
                ...current.privacy,
                crashReporting: checked,
              },
            }))
          }}
        />

        <ToggleRow
          checked={settings.privacy.updateCheck}
          label="自动检查更新"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              privacy: {
                ...current.privacy,
                updateCheck: checked,
              },
            }))
          }}
        />
      </SettingsGroup>
    </SettingsPage>
  )
})

const AboutSettings = memo(function AboutSettings() {
  return (
    <SettingsPage>
      <div className="settings-about-card">
        <div aria-hidden="true" className="settings-about-card__logo">
          HC
        </div>

        <div className="settings-about-card__copy">
          <strong>Poietica</strong>
          <span>Version 0.1.0</span>
          <p>使用 React、Tauri、Rust 和 tldraw 构建。</p>
        </div>
      </div>

      <div className="settings-principles">
        <ArchitecturePrinciple description="统一各类Agnet交互规范" index="01" title="ACP集成" />

        <ArchitecturePrinciple
          description="文档和设置优先安全保存在当前设备"
          index="02"
          title="本地优先"
        />

        <ArchitecturePrinciple
          description="原子文件写入、明确边界和可恢复流程"
          index="03"
          title="安全可靠"
        />

        <ArchitecturePrinciple
          description="界面保持轻量，长任务不阻塞主线程"
          index="04"
          title="高性能"
        />
      </div>

      <dl className="settings-about-details">
        <div>
          <dt>画布内核</dt>
          <dd>tldraw Editor / TLStore</dd>
        </div>

        <div>
          <dt>桌面运行时</dt>
          <dd>Tauri</dd>
        </div>

        <div>
          <dt>设置存储</dt>
          <dd>Tauri Store</dd>
        </div>

        <div>
          <dt>文档格式</dt>
          <dd>.draw</dd>
        </div>
      </dl>
    </SettingsPage>
  )
})

interface SettingsPageProps {
  readonly children: ReactNode
}

function SettingsPage({ children }: SettingsPageProps) {
  return (
    <section className="settings-page">
      <div className="settings-page__body">{children}</div>
    </section>
  )
}

interface SettingsGroupProps {
  readonly title: string
  readonly children: ReactNode
}

function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <section className="settings-group">
      <header className="settings-group__header">
        <h3>{title}</h3>
      </header>

      <div className="settings-group__surface">{children}</div>
    </section>
  )
}

interface SettingRowProps {
  readonly label: string
  readonly children: ReactNode
}

function SettingRow({ label, children }: SettingRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <strong>{label}</strong>
      </div>

      <div className="settings-row__control">{children}</div>
    </div>
  )
}

interface ToggleRowProps {
  readonly checked: boolean
  readonly label: string
  readonly onChange: (checked: boolean) => void
}

function ToggleRow({ checked, label, onChange }: ToggleRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <strong>{label}</strong>
      </div>

      <div className="settings-row__control">
        <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
      </div>
    </div>
  )
}

interface SettingsSelectProps<TValue extends string> {
  readonly ariaLabel: string
  readonly value: TValue
  readonly options: readonly (readonly [TValue, string])[]
  readonly disabled?: boolean
  readonly onChange: (value: TValue) => void
}

function SettingsSelect<TValue extends string>({
  ariaLabel,
  value,
  options,
  disabled = false,
  onChange,
}: SettingsSelectProps<TValue>) {
  const data: readonly SelectOption[] = options.map(([optionValue, label]) => ({
    value: optionValue,
    label,
  }))

  return (
    <Select
      data={data}
      disabled={disabled}
      onValueChange={(nextValue) => {
        onChange(nextValue as TValue)
      }}
      type={ariaLabel}
      value={value}
    >
      <SelectTrigger aria-label={ariaLabel} className="settings-select-trigger" />

      <SelectContent>
        <SelectList>
          <SelectGroup>
            {options.map(([optionValue, label]) => (
              <SelectItem key={optionValue} value={optionValue}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectList>
      </SelectContent>
    </Select>
  )
}

interface SettingsErrorBannerProps {
  readonly operation: SettingsOperation | undefined
  readonly message: string
  readonly onRetry: () => void
}

function SettingsErrorBanner({ operation, message, onRetry }: SettingsErrorBannerProps) {
  const operationLabel =
    operation === 'reset' ? '重置设置失败' : operation === 'save' ? '保存设置失败' : '读取设置失败'

  return (
    <div className="settings-error" role="alert">
      <div>
        <strong>{operationLabel}</strong>
        <p>{message}</p>
      </div>

      <Button onClick={onRetry} size="sm" type="button" variant="outline">
        重试
      </Button>
    </div>
  )
}

interface ArchitecturePrincipleProps {
  readonly index: string
  readonly title: string
  readonly description: string
}

function ArchitecturePrinciple({ index, title, description }: ArchitecturePrincipleProps) {
  return (
    <article className="settings-principle">
      <span>{index}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </article>
  )
}

function SectionIcon({ section }: { readonly section: SettingsSection }) {
  const paths: Record<SettingsSection, ReactNode> = {
    general: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    canvas: (
      <>
        <rect height="16" rx="2" width="16" x="4" y="4" />
        <path d="M4 9h16M9 4v16" />
      </>
    ),
    export: (
      <>
        <path d="M12 3v12" />
        <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
        <path d="M5 19h14" />
      </>
    ),
    privacy: (
      <>
        <path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    about: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      className="settings-navigation__icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[section]}
    </svg>
  )
}
