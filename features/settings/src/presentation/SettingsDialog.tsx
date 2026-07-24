import { Button, Dialog, ErrorState, LoadingState, Switch } from '@hybrid-canvas/design-system'
import { type ChangeEvent, memo, type ReactNode, useCallback, useId, useState } from 'react'
import type { AppSettings, ThemeMode } from '../domain/settings'
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

              <SettingsActions controller={controller} />

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
    <SettingsPage
      description="控制应用外观、界面语言和文档保存方式。"
      eyebrow="Application"
      title="常规"
    >
      <SettingsGroup description="界面会立即预览颜色模式，取消时恢复原来的主题。" title="外观">
        <SettingRow description="选择适合当前环境的应用颜色模式。" label="颜色模式">
          <SegmentedControl
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

        <SettingRow description="更改应用菜单与设置界面的显示语言。" label="界面语言">
          <NativeSelect
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

      <SettingsGroup description="自动保存只写入当前文档，不会创建第二套画布状态。" title="保存">
        <ToggleRow
          checked={settings.autoSave}
          description="编辑时定期将 TLStore 文档快照安全写入当前文件。"
          label="自动保存"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              autoSave: checked,
            }))
          }}
        />

        {settings.autoSave ? (
          <SettingRow description="频繁保存更安全，较长间隔可以减少磁盘写入。" label="保存间隔">
            <NativeSelect
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

        <SettingRow description="将应用、画布、导出和隐私选项恢复为初始值。" label="恢复默认设置">
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
    <SettingsPage
      description="调整 tldraw 画布的视图辅助功能和默认行为。"
      eyebrow="Canvas"
      title="画布"
    >
      <SettingsGroup description="这些选项只改变画布交互和显示，不复制文档状态。" title="视图">
        <ToggleRow
          checked={settings.canvas.infiniteCanvas}
          description="允许在所有方向持续扩展工作区域。"
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
          description="在画布边缘显示位置和尺寸参考。"
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

        <SettingRow description="新建或首次打开画布时使用的缩放比例。" label="默认缩放">
          <NativeSelect
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

      <SettingsGroup description="网格提供视觉参考，吸附用于更精确地排列图形。" title="网格与吸附">
        <ToggleRow
          checked={settings.canvas.showGrid}
          description="在画布背景中显示轻量辅助网格。"
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
          description="移动和创建图形时自动对齐到网格。"
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

        <SettingRow description="控制网格线和吸附点之间的距离。" label="网格尺寸">
          <NativeSelect
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
    <SettingsPage
      description="设置画布导出的默认格式、清晰度和文档信息。"
      eyebrow="Export"
      title="导出"
    >
      <SettingsGroup description="导出不会修改画布中的原始 TLStore 文档记录。" title="默认输出">
        <SettingRow description="执行快速导出时优先使用的文件格式。" label="文件格式">
          <NativeSelect
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

        <SettingRow description="用于 PNG 导出的像素密度。" label="PNG 清晰度">
          <NativeSelect
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

        <SettingRow description="较高质量会生成更大的 PDF 文件。" label="PDF 质量">
          <RangeControl
            ariaLabel="PDF 导出质量"
            onChange={(value) => {
              controller.update((current) => ({
                ...current,
                export: {
                  ...current.export,
                  pdfQuality: value,
                },
              }))
            }}
            value={settings.export.pdfQuality}
          />
        </SettingRow>

        <ToggleRow
          checked={settings.export.includeMetadata}
          description="在支持的格式中保留应用版本和画布元数据。"
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
    <SettingsPage
      description="Hybrid Canvas 默认以本地优先方式处理文档和设置。"
      eyebrow="Privacy"
      title="隐私"
    >
      <div className="settings-privacy-note">
        <span aria-hidden="true" className="settings-privacy-note__icon">
          ✓
        </span>

        <div>
          <strong>你的画布默认保留在设备上</strong>
          <p>文档内容不会因为启用诊断或更新检查而自动上传。</p>
        </div>
      </div>

      <SettingsGroup description="你可以独立控制每一种联网或诊断行为。" title="诊断与更新">
        <ToggleRow
          checked={settings.privacy.telemetry}
          description="发送不包含画布内容的匿名功能使用统计。"
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
          description="发生崩溃时发送诊断信息，不包含画布文档。"
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
          description="启动后检查是否存在新的稳定版本。"
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
    <SettingsPage
      description="一个以 tldraw 为核心的本地优先桌面画布应用。"
      eyebrow="About"
      title="Hybrid Canvas"
    >
      <div className="settings-about-card">
        <div aria-hidden="true" className="settings-about-card__logo">
          HC
        </div>

        <div className="settings-about-card__copy">
          <strong>Hybrid Canvas</strong>
          <span>Version 0.1.0</span>
          <p>使用 React、Tauri、Rust 和 tldraw 构建。</p>
        </div>
      </div>

      <div className="settings-principles">
        <ArchitecturePrinciple
          description="Editor 与 TLStore 是画布文档唯一事实来源。"
          index="01"
          title="tldraw-first"
        />

        <ArchitecturePrinciple
          description="文档和设置优先安全保存在当前设备。"
          index="02"
          title="本地优先"
        />

        <ArchitecturePrinciple
          description="原子文件写入、明确边界和可恢复流程。"
          index="03"
          title="安全可靠"
        />

        <ArchitecturePrinciple
          description="界面保持轻量，长任务不阻塞主线程。"
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
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}

function SettingsPage({ title, description, children }: SettingsPageProps) {
  return (
    <section className="settings-page">
      <header className="settings-page__header">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>

      <div className="settings-page__body">{children}</div>
    </section>
  )
}

interface SettingsGroupProps {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
}

function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <section className="settings-group">
      <header className="settings-group__header">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>

      <div className="settings-group__surface">{children}</div>
    </section>
  )
}

interface SettingRowProps {
  readonly label: string
  readonly description: string
  readonly children: ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <strong>{label}</strong>
        <p>{description}</p>
      </div>

      <div className="settings-row__control">{children}</div>
    </div>
  )
}

interface ToggleRowProps {
  readonly checked: boolean
  readonly label: string
  readonly description: string
  readonly onChange: (checked: boolean) => void
}

function ToggleRow({ checked, label, description, onChange }: ToggleRowProps) {
  const descriptionId = useId()

  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <strong>{label}</strong>
        <p id={descriptionId}>{description}</p>
      </div>

      <div className="settings-row__control">
        <Switch
          aria-describedby={descriptionId}
          aria-label={label}
          checked={checked}
          onCheckedChange={onChange}
        />
      </div>
    </div>
  )
}

interface NativeSelectProps {
  readonly ariaLabel: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
}

function NativeSelect({
  ariaLabel,
  value,
  options,
  disabled = false,
  onChange,
}: NativeSelectProps) {
  return (
    <select
      aria-label={ariaLabel}
      className="settings-select"
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
        onChange(event.target.value)
      }}
      value={value}
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  )
}

interface SegmentedControlProps {
  readonly ariaLabel: string
  readonly value: ThemeMode
  readonly options: readonly (readonly [ThemeMode, string])[]
  readonly onChange: (value: ThemeMode) => void
}

function SegmentedControl({ ariaLabel, value, options, onChange }: SegmentedControlProps) {
  return (
    <div aria-label={ariaLabel} className="settings-segmented" role="radiogroup">
      {options.map(([optionValue, label]) => (
        <button
          aria-checked={value === optionValue}
          data-active={value === optionValue ? 'true' : 'false'}
          key={optionValue}
          onClick={() => {
            onChange(optionValue)
          }}
          role="radio"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

interface RangeControlProps {
  readonly ariaLabel: string
  readonly value: number
  readonly onChange: (value: number) => void
}

function RangeControl({ ariaLabel, value, onChange }: RangeControlProps) {
  return (
    <div className="settings-range">
      <input
        aria-label={ariaLabel}
        max="100"
        min="50"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(Number(event.target.value))
        }}
        step="5"
        type="range"
        value={value}
      />

      <output>{value}%</output>
    </div>
  )
}

interface SettingsActionsProps {
  readonly controller: SettingsController
}

function SettingsActions({ controller }: SettingsActionsProps) {
  return (
    <div className="settings-content-actions">
      <Button
        disabled={controller.saving}
        onClick={controller.requestClose}
        type="button"
        variant="ghost"
      >
        取消
      </Button>

      <Button
        disabled={controller.saving || !controller.settings || !controller.dirty}
        onClick={controller.save}
        type="button"
      >
        {controller.saving && controller.operation === 'save' ? '正在保存…' : '保存'}
      </Button>
    </div>
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
