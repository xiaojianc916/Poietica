import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from '@mynaui/icons-react'
import { Button, cn } from '@poietica/foundations-design-system'
import type { ReactNode } from 'react'

const WINDOW_CONTROLS_DISABLED_TITLE = '窗口控制暂时不可用'

export interface DesktopTitleBarProps {
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
       * 它的宽度就是侧边栏列宽，所以右边界那条竖线与"侧边栏／主界面"的分隔线
       * 是同一个 x 坐标，并且跟着同一条动画时间轴滑动、收起时一起消失。原先
       * 竖线画在一个独立的填充块上、按钮另占一格 rail 宽，两者的位置各自成立
       * 却互不相干，对齐只能靠巧合。
       *
       * 开合按钮绝对定位、不参与这个宽度：列宽收起时归零，跟着流布局会被裁掉。
       * 横向位置锚在 --workspace-sidebar-nav-icon-center 上，与下方导航项的图标
       * 共用一条中线。
       *
       * 这里不标注 data-tauri-drag-region：原生拖拽一旦开始就吞掉 click，把它挂
       * 在含按钮的容器上会让按钮静默失灵。
       */}
      <div
        className="relative shrink-0 overflow-visible border-b border-divider"
        style={{
          borderRightStyle: 'solid',
          borderRightWidth: isSidebarOpen ? 'var(--ui-region-divider-width)' : 0,
          width: 'var(--workspace-sidebar-column-width, 0px)',
        }}
      >
        <Button
          aria-label={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          className="absolute top-1/2 size-[var(--ui-control-height-sm)] -translate-y-1/2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          onClick={onSidebarToggle}
          size="icon"
          style={{
            left: 'calc(var(--workspace-sidebar-nav-icon-center) - var(--ui-control-height-sm) / 2)',
          }}
          type="button"
          variant="ghost"
        >
          {isSidebarOpen ? (
            <PanelLeftClose aria-hidden="true" className="size-4" />
          ) : (
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          )}
        </Button>
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
