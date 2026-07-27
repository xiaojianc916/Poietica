import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from '@mynaui/icons-react'
import { Button, cn } from '@poietica/foundations-design-system'
import type { ReactNode } from 'react'

const WINDOW_CONTROLS_DISABLED_TITLE = '窗口控制暂时不可用'

/*
 * 开合按钮与两个箭头共用一套尺寸与配色：它们是同一组 chrome 控件，样式只有
 * 一份来源，不是三处各写一串。
 */
const CHROME_ICON_BUTTON_CLASS =
  'size-[var(--ui-control-height-sm)] shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'

/**
 * 移动当前标签页的能力。
 *
 * 能否移动由标签列表决定，所以在拥有列表的那一层派生；标题栏只把它映射成按钮
 * 的 disabled 与 onClick，不认识标签、也不算索引——重排本身仍然只有工作台
 * store 的 moveTab 一条实现，拖拽、键盘和这两个箭头走的是同一条。
 */
export interface ActiveTabOrdering {
  readonly canMoveEarlier: boolean
  readonly canMoveLater: boolean
  readonly moveEarlier: () => void
  readonly moveLater: () => void
}

export interface DesktopTitleBarProps {
  readonly activeTabOrdering: ActiveTabOrdering
  readonly children: ReactNode
  readonly onMinimize: () => void
  readonly onMaximize: () => void
  readonly onClose: () => void
  readonly onSidebarToggle: () => void
  readonly isSidebarOpen: boolean
  readonly isMaximized: boolean
  readonly windowControlsDisabled?: boolean
}

/**
 * Desktop platform chrome.
 *
 * 窗口拖拽与双击最大化由 Tauri 原生处理：标注 data-tauri-drag-region 的元素
 * 交给 webview（capabilities 已声明 core:window:allow-start-dragging），前端
 * 不再监听 mousedown、不再维护"哪些元素算交互元素"的黑名单、也不再有一条会
 * 失败的原生拖拽调用需要降级。
 *
 * 只有不含交互子元素的填充区域才标注。原生拖拽一旦开始就吞掉 click，把标注
 * 挂在包含按钮的容器上会让按钮静默失灵——这正是黑名单方案要兜的底，而结构
 * 上不可能误命中就不需要兜底。
 *
 * 这里没有容器级 ARIA 角色。原先整条标注 role="toolbar"，而 toolbar 的契约是
 * roving tabindex（Tab 只停一次、内部方向键移动），本组件从未实现；它的子元素
 * 里还有一整条 role="tablist"，也不是 toolbar 的合法子元素。声明一个不兑现的
 * 角色比不声明更糟：按钮和标签条各自的名字已经足够被读出。
 */
export function DesktopTitleBar({
  activeTabOrdering,
  children,
  onMinimize,
  onMaximize,
  onClose,
  onSidebarToggle,
  isSidebarOpen,
  isMaximized,
  windowControlsDisabled = false,
}: DesktopTitleBarProps) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 items-stretch bg-chrome">
      {/*
       * 左上角一个区域，不是两个。
       *
       * 宽度 = max(侧边栏列宽, 开合按钮容器宽)。展开时列宽胜出，右边界与
       * "侧边栏／主界面"分隔线是同一个 x 坐标，竖线因此天然对齐而不是靠手调；
       * 收起时列宽归零、由按钮容器托底，开合按钮永远有落脚点。
       *
       * 两个诉求不冲突的前提是：竖线在收起时本来就不存在，所以对齐这个约束
       * 只需要在展开时成立。
       *
       * 按钮留在正常流里。绝对定位同样能固定位置，但列宽归零后它会溢出到右侧
       * 标签条的地盘，被标签条的层叠上下文和不透明底色盖住——按钮还在、只是
       * 点不到，这正是上一版的故障。
       *
       * 宽度直接读 motion 正在驱动的 --workspace-sidebar-column-width，收缩过程
       * 跟着面板同一条时间轴、到兜底宽度自然刹停，不需要另写一套动画。
       *
       * 这里不标注 data-tauri-drag-region：原生拖拽一旦开始就吞掉 click，把它挂
       * 在含按钮的容器上会让按钮静默失灵。
       */}
      <div
        className="relative flex shrink-0 items-center border-b border-divider"
        style={{
          paddingLeft:
            'calc(var(--workspace-sidebar-nav-icon-center) - var(--ui-control-height-sm) / 2)',
          width:
            'max(var(--workspace-sidebar-column-width, 0px), var(--workspace-sidebar-toggle-zone))',
        }}
      >
        <Button
          aria-label={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          className={CHROME_ICON_BUTTON_CLASS}
          onClick={onSidebarToggle}
          size="icon"
          type="button"
          variant="ghost"
        >
          {isSidebarOpen ? (
            <PanelLeftClose aria-hidden="true" className="size-4" />
          ) : (
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          )}
        </Button>

        {/*
         * 移动标签页的两个箭头。
         *
         * ml-auto 把它们顶到本区域的右边界，而这个边界就是"侧边栏／主界面"
         * 分隔线所在的 x —— 上面那个 max() 是它唯一的来源，箭头因此没有第二
         * 份坐标要维护。
         *
         * 侧边栏收起时不渲染：那时列宽归零，本区域缩到只容得下开合按钮，
         * 箭头没有落脚点。用户要的"关闭时消失"与布局的约束在这里是同一件事。
         *
         * 首/末标签时按钮禁用。禁用之后 onClick 不会触发，所以处理器里不再
         * 补一层守卫——那会是死代码。
         */}
        {isSidebarOpen ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 pr-1.5">
            <TabOrderButton
              ariaLabel="将当前标签页左移"
              disabled={!activeTabOrdering.canMoveEarlier}
              onClick={activeTabOrdering.moveEarlier}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </TabOrderButton>

            <TabOrderButton
              ariaLabel="将当前标签页右移"
              disabled={!activeTabOrdering.canMoveLater}
              onClick={activeTabOrdering.moveLater}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </TabOrderButton>
          </div>
        ) : null}

        {/*
         * 竖线是一个独立元素而不是容器的 border-right：border 宽度在 1px 和 0
         * 之间只能硬切，而这条线该跟着面板一起淡出。它贴在容器右边界上，所以
         * 位置仍然由上面那个 max() 唯一决定，没有第二份坐标。
         */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 border-r border-divider"
          style={{
            opacity: isSidebarOpen ? 1 : 0,
            transition: 'opacity var(--workspace-layout-duration, 0.18s) ease',
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 items-stretch">{children}</div>

      <div className="flex shrink-0 items-stretch border-b border-divider">
        <WindowControlButton
          ariaLabel="最小化"
          disabled={windowControlsDisabled}
          onClick={onMinimize}
          title="最小化"
        >
          <Minus aria-hidden="true" className="size-3.5" />
        </WindowControlButton>

        <WindowControlButton
          ariaLabel={isMaximized ? '还原窗口' : '最大化窗口'}
          disabled={windowControlsDisabled}
          onClick={onMaximize}
          title={isMaximized ? '还原窗口' : '最大化窗口'}
        >
          {isMaximized ? (
            <Copy aria-hidden="true" className="size-3.5" />
          ) : (
            <Square aria-hidden="true" className="size-3" />
          )}
        </WindowControlButton>

        <WindowControlButton ariaLabel="关闭" close onClick={onClose} title="关闭">
          <X aria-hidden="true" className="size-4" />
        </WindowControlButton>
      </div>
    </div>
  )
}

interface TabOrderButtonProps {
  readonly ariaLabel: string
  readonly children: ReactNode
  readonly disabled: boolean
  readonly onClick: () => void
}

/* 名字即提示：aria-label 与 title 同一份文案，不存在两处要同步的说明。 */
function TabOrderButton({ ariaLabel, children, disabled, onClick }: TabOrderButtonProps) {
  return (
    <Button
      aria-label={ariaLabel}
      className={cn(CHROME_ICON_BUTTON_CLASS, disabled && 'cursor-not-allowed opacity-40')}
      disabled={disabled}
      onClick={onClick}
      size="icon"
      title={ariaLabel}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}

interface WindowControlButtonProps {
  readonly ariaLabel: string
  readonly children: ReactNode
  readonly onClick: () => void
  readonly title: string
  readonly disabled?: boolean
  readonly close?: boolean
}

/*
 * 宽度与禁用文案都由 close / disabled 推导，不再从外面递进来：两者原本各自
 * 只有两种取值且完全由这两个布尔量决定，作为 prop 等于给同一个判断开了第二个
 * 入口。关闭键按 Windows 惯例比其余控制键宽一档，并且永不禁用——它走的是应用
 * 退出流程，不依赖原生窗口能力。
 */
function WindowControlButton({
  ariaLabel,
  children,
  onClick,
  title,
  disabled = false,
  close = false,
}: WindowControlButtonProps) {
  return (
    <Button
      aria-label={ariaLabel}
      className={cn(
        'h-full rounded-none',
        'px-0 shadow-none',
        'text-muted-foreground',
        'focus-visible:relative',
        'focus-visible:z-10',
        'focus-visible:ring-inset',
        close ? 'w-12' : 'w-11',
        close
          ? [
              'hover:bg-[var(--desktop-window-close-hover)]',
              'enabled:active:bg-[var(--desktop-window-close-active)]',
              'hover:text-[var(--desktop-window-close-foreground)]',
              'focus-visible:bg-[var(--desktop-window-close-hover)]',
              'focus-visible:text-[var(--desktop-window-close-foreground)]',
            ]
          : [
              'enabled:hover:bg-[var(--desktop-window-control-hover)]',
              'enabled:active:bg-[var(--desktop-window-control-active)]',
              'enabled:hover:text-foreground',
            ],
        disabled && 'cursor-not-allowed opacity-40',
      )}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? WINDOW_CONTROLS_DISABLED_TITLE : title}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}
