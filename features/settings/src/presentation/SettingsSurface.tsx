import {
  Button,
  ErrorState,
  LoadingState,
  PencilRulerIcon,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  type SelectOption,
  SelectTrigger,
  Switch,
  WebhookIcon,
} from '@poietica/foundations-design-system'
import type { AppSettings } from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'
import {
  type ComponentType,
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { AgentConfigStore } from '../ports/agent-config-store'
import type { SettingsStore } from '../ports/settings-store'
import { ModelsSettings } from './ModelsSettings'
import {
  type SettingsController,
  type SettingsOperation,
  useSettingsController,
} from './useSettingsController'
import './settings-surface.css'

type SettingsSection =
  | 'general'
  | 'appearance'
  | 'models'
  | 'keymap'
  | 'hooks'
  | 'plugins'
  | 'canvas'
  | 'export'
  | 'privacy'
  | 'about'

interface SectionDefinition {
  readonly id: SettingsSection
  readonly label: string
}

/*
 * 导航顺序照图二排，但没有删掉图二没画的三组。
 *
 * canvas / export / privacy 里的每一项都写进 AppSettings 并落盘，按截图裁掉
 * 它们等于删功能。models / keymap / hooks / plugins 在 AppSettings 里还没有
 * 任何字段，所以它们渲染明确的空状态，而不是拨得动却存不下的假开关。
 */
const SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'general',
    label: '通用',
  },
  {
    id: 'appearance',
    label: '外观',
  },
  {
    id: 'models',
    label: '模型',
  },
  {
    id: 'keymap',
    label: '快捷键',
  },
  {
    id: 'hooks',
    label: 'Hook',
  },
  {
    id: 'plugins',
    label: '插件',
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

/**
 * 导航分组。图二用间距而不是标题分隔分组，所以这里只描述分组关系，
 * 标签仍然来自 SECTIONS，避免同一份文案出现两处。
 */
const SECTION_GROUPS: readonly (readonly SettingsSection[])[] = [
  ['general', 'appearance'],
  ['models', 'keymap', 'hooks', 'plugins'],
  ['canvas', 'export', 'privacy'],
  ['about'],
]

function findSection(id: SettingsSection): SectionDefinition {
  const section = SECTIONS.find((item) => item.id === id)

  if (!section) {
    throw new Error(`未知的设置分类：${id}`)
  }

  return section
}

/*
 * 设置导航与设置内容是外壳栅格里两个互不嵌套的格子（第 1 列与第 2 列）。
 *
 * 它们没有父子关系，所以控制器与当前分类只能由共同祖先持有。这就是这个
 * context 存在的唯一理由：不是为了解耦，而是因为 DOM 上没有别的地方可放。
 * 侧边栏的宽度、拖拽与开合仍然只有 workspaceLayoutStore 一个来源。
 */
interface SettingsSurfaceContextValue {
  readonly agentConfigStore: AgentConfigStore | undefined
  readonly controller: SettingsController
  readonly section: SettingsSection
  readonly onSelect: (section: SettingsSection) => void
  readonly onBack: () => void
}

const SettingsSurfaceContext = createContext<SettingsSurfaceContextValue | null>(null)

function useSettingsSurface(): SettingsSurfaceContextValue {
  const value = useContext(SettingsSurfaceContext)

  if (!value) {
    throw new Error('设置区域必须渲染在 SettingsProvider 内部。')
  }

  return value
}

export interface SettingsProviderProps {
  /** ACP agent 与模型提供方配置。未注入时模型页只说明尚未接线。 */
  readonly agentConfigStore?: AgentConfigStore | undefined
  readonly store: SettingsStore
  /** 离开设置。控制器会先把尚未落盘的草稿刷完再回调，所以退出不会丢改动。 */
  readonly onDismiss: () => void
  readonly children: ReactNode
}

export function SettingsProvider({
  agentConfigStore,
  store,
  onDismiss,
  children,
}: SettingsProviderProps) {
  const [section, setSection] = useState<SettingsSection>('general')

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onDismiss()
      }
    },
    [onDismiss],
  )

  // open 恒为 true：Provider 只在设置打开时挂载，开合由外壳决定。
  const controller = useSettingsController({
    open: true,
    store,
    onOpenChange: handleOpenChange,
  })

  const value = useMemo<SettingsSurfaceContextValue>(
    () => ({
      agentConfigStore,
      controller,
      section,
      onSelect: setSection,
      onBack: controller.requestClose,
    }),
    [agentConfigStore, controller, section],
  )

  return <SettingsSurfaceContext.Provider value={value}>{children}</SettingsSurfaceContext.Provider>
}

export interface SettingsNavigationRegionProps {
  /** 侧边栏底部行，由应用组合根注入，齿轮在设置里保持高亮。 */
  readonly footer?: ReactNode
}

export function SettingsNavigationRegion({ footer }: SettingsNavigationRegionProps) {
  const { section, onSelect, onBack } = useSettingsSurface()

  return (
    <SettingsNavigation
      activeSection={section}
      footer={footer}
      onBack={onBack}
      onSelect={onSelect}
    />
  )
}

export function SettingsContentRegion() {
  const { agentConfigStore, controller, section } = useSettingsSurface()

  return (
    <div aria-live="polite" className="settings-content">
      <div className="settings-content__inner">
        <h2 className="settings-content__title">{findSection(section).label}</h2>

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
              agentConfigStore={agentConfigStore}
              controller={controller}
              section={section}
              settings={controller.settings}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

interface SettingsNavigationProps {
  readonly activeSection: SettingsSection
  readonly onSelect: (section: SettingsSection) => void
  readonly onBack: () => void
  readonly footer?: ReactNode
}

const SettingsNavigation = memo(function SettingsNavigation({
  activeSection,
  onSelect,
  onBack,
  footer,
}: SettingsNavigationProps) {
  return (
    <section aria-label="设置分类" className="settings-navigation">
      <button className="settings-navigation__back" onClick={onBack} type="button">
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
          <path d="M19 12H5" />
          <path d="m11 6-6 6 6 6" />
        </svg>

        <span>返回</span>
      </button>

      <div className="settings-navigation__scroll">
        {SECTION_GROUPS.map((group) => (
          <nav className="settings-navigation__items" key={group.join('-')}>
            {group.map((id) => {
              const active = id === activeSection

              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  className="settings-navigation__item"
                  data-active={active ? 'true' : 'false'}
                  key={id}
                  onClick={() => {
                    onSelect(id)
                  }}
                  type="button"
                >
                  <SectionIcon section={id} />

                  <span>{findSection(id).label}</span>
                </button>
              )
            })}
          </nav>
        ))}
      </div>

      {footer ? <div className="settings-navigation__footer">{footer}</div> : null}
    </section>
  )
})

interface SettingsSectionContentProps {
  readonly agentConfigStore: AgentConfigStore | undefined
  readonly section: SettingsSection
  readonly settings: AppSettings
  readonly controller: SettingsController
}

function SettingsSectionContent({
  agentConfigStore,
  section,
  settings,
  controller,
}: SettingsSectionContentProps) {
  switch (section) {
    case 'general':
      return <GeneralSettings controller={controller} settings={settings} />

    case 'appearance':
      return <AppearanceSettings controller={controller} settings={settings} />

    case 'models':
      return <ModelsSettings store={agentConfigStore} />

    case 'keymap':
      return (
        <SettingsPlaceholder description="快捷键还不可改写。当前生效的绑定可在命令面板（Mod+K）中查看。" />
      )

    case 'hooks':
      return <SettingsPlaceholder description="Hook 尚未实现。" />

    case 'plugins':
      return <SettingsPlaceholder description="插件系统尚未实现。" />

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
      <SettingsGroup title="保存">
        <ToggleRow
          checked={settings.autoSave}
          description="画布变更后自动写入本地文件"
          label="自动保存"
          onChange={(checked) => {
            controller.update((current) => ({
              ...current,
              autoSave: checked,
            }))
          }}
        />

        {settings.autoSave ? (
          <SettingRow description="距上次变更多久触发一次写入" label="保存间隔">
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

        <SettingRow description="把全部设置项还原为初始值" label="恢复默认设置">
          <Button
            disabled={controller.saving}
            onClick={controller.reset}
            size="xs"
            type="button"
            variant="soft"
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
          description="关闭后画布限制在固定边界内"
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
          description="在画布边缘显示刻度"
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

        <SettingRow description="新建画布时的初始缩放比例" label="默认缩放">
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
          description="在画布背景绘制网格"
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
          description="移动图形时对齐到网格交点"
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

        <SettingRow description="网格线之间的像素间距" label="网格尺寸">
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
        <SettingRow description="导出时默认选中的格式" label="文件格式">
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

        <SettingRow description="位图导出的分辨率" label="PNG 清晰度">
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

        <SettingRow description="矢量转位图时的压缩质量" label="PDF 质量">
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
          description="在导出文件中写入创建信息"
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
      <SettingsGroup title="诊断与更新">
        <ToggleRow
          checked={settings.privacy.telemetry}
          description="上报不含文档内容的功能使用统计"
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
          description="崩溃时上报堆栈以便定位问题"
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
          description="启动时向更新服务查询新版本"
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
  readonly description?: string
  readonly children: ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <strong>{label}</strong>
        {description ? <p>{description}</p> : null}
      </div>

      <div className="settings-row__control">{children}</div>
    </div>
  )
}

interface ToggleRowProps {
  readonly checked: boolean
  readonly label: string
  readonly description?: string
  readonly onChange: (checked: boolean) => void
}

function ToggleRow({ checked, label, description, onChange }: ToggleRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <strong>{label}</strong>
        {description ? <p>{description}</p> : null}
      </div>

      <div className="settings-row__control">
        <Switch aria-label={label} checked={checked} onCheckedChange={onChange} size="sm" />
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
      <SelectTrigger
        aria-label={ariaLabel}
        className="settings-select-trigger"
        size="sm"
        tone="plain"
      />

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

type GlyphComponent = ComponentType<{
  readonly className?: string
  readonly 'aria-hidden'?: 'true'
}>

/*
 * 分类图标有两个来源，各自穷尽自己的分类集合。
 *
 * GlyphSection 里的分类直接用主侧边栏的字形组件：Hook 与画布在主导航里已经有
 * 确定的画法，设置里再描一份 path 就是第二个来源，两处迟早对不上。
 *
 * 图标不从 features/workspace 的导航注册表取：features-settings 依赖另一个
 * feature 会被架构测试拦下。两边共同的下游是 design-system，所以两处引用的是
 * 同一个组件，而不是同一张图的两份摹本。
 *
 * 拆成两张 Record 而不是在组件里写 if：新增分类时 PathSection 一侧会缺键，
 * typecheck 阶段就会失败，而不是运行时渲染出一个空图标。
 */
type GlyphSection = 'canvas' | 'hooks'

type PathSection = Exclude<SettingsSection, GlyphSection>

const SECTION_GLYPHS: Record<GlyphSection, GlyphComponent> = {
  canvas: PencilRulerIcon,
  hooks: WebhookIcon,
}

function isGlyphSection(section: SettingsSection): section is GlyphSection {
  return section === 'canvas' || section === 'hooks'
}

function SectionIcon({ section }: { readonly section: SettingsSection }) {
  if (isGlyphSection(section)) {
    const Glyph = SECTION_GLYPHS[section]

    return <Glyph aria-hidden="true" className="settings-navigation__icon" />
  }

  const paths: Record<PathSection, ReactNode> = {
    general: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    appearance: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      </>
    ),
    models: (
      <>
        <rect height="12" rx="2" width="12" x="6" y="6" />
        <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
      </>
    ),
    keymap: (
      <>
        <rect height="12" rx="2" width="18" x="3" y="6" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
      </>
    ),
    plugins: (
      <>
        <path d="M9 3v4H7a2 2 0 0 0-2 2v3h2.5a2 2 0 1 1 0 4H5v3a2 2 0 0 0 2 2h3v-2.5a2 2 0 1 1 4 0V21h3a2 2 0 0 0 2-2v-3h-2.5a2 2 0 1 1 0-4H19V9a2 2 0 0 0-2-2h-2V3Z" />
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

const AppearanceSettings = memo(function AppearanceSettings({
  settings,
  controller,
}: SettingsPanelProps) {
  return (
    <SettingsPage>
      <SettingsGroup title="主题与语言">
        <SettingRow description="浅色、深色或跟随系统" label="颜色模式">
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

        <SettingRow description="界面文案使用的语言" label="界面语言">
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
    </SettingsPage>
  )
})

interface SettingsPlaceholderProps {
  readonly description: string
}

/*
 * 一个还没有数据的分组说自己没有数据。
 *
 * 这里刻意不放能拨动的控件：写不进 AppSettings 的开关会让人以为设置生效了，
 * 比一句实话有害得多。
 *
 * 也刻意没有标题。分类标题由 SettingsContentRegion 从 SECTIONS 渲染，这里再画
 * 一个只会让同一句文案出现两遍、并且多出第二个来源。
 */
function SettingsPlaceholder({ description }: SettingsPlaceholderProps) {
  return (
    <SettingsPage>
      <p className="settings-placeholder">{description}</p>
    </SettingsPage>
  )
}
