import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from '@mynaui/icons-react'
import { Button, cn } from '@poietica/foundations-design-system'
import type { ReactNode } from 'react'

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
    <div className={cn('flex h-full', 'min-h-0 min-w-0', 'bg-chrome')}>
      <div
        aria-label="窗口标题栏"
        className={cn('flex h-full', 'min-h-0 w-full', 'items-stretch')}
        role="toolbar"
      >
        <div
          className={cn(
            'flex',
            'w-(--activity-rail-width)',
            'shrink-0 items-center',
            'justify-center',
            'border-b border-divider',
          )}
        >
          <Button
            aria-label={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            className={cn(
              'size-[var(--ui-control-height-sm)]',
              'text-muted-foreground',
              'hover:bg-sidebar-accent',
              'hover:text-foreground',
            )}
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
        </div>

        <div
          className={cn('shrink-0', 'border-b border-divider')}
          data-tauri-drag-region
          style={{
            borderRightStyle: 'solid',
            borderRightWidth: isSidebarOpen ? 'var(--ui-region-divider-width)' : 0,
            width: 'var(--workspace-sidebar-column-width, 0px)',
          }}
        />

        <div className={cn('flex min-w-0', 'flex-1 items-stretch')}>{children}</div>

        <div className={cn('flex shrink-0', 'items-stretch', 'border-b border-divider')}>
          <WindowControlButton
            ariaLabel="最小化"
            disabled={windowControlsDisabled}
            disabledTitle="窗口控制暂时不可用"
            onClick={onMinimize}
            title="最小化"
            widthClassName="w-11"
          >
            <Minus aria-hidden="true" className="size-3.5" />
          </WindowControlButton>

          <WindowControlButton
            ariaLabel={isMaximized ? '还原窗口' : '最大化窗口'}
            disabled={windowControlsDisabled}
            disabledTitle="窗口控制暂时不可用"
            onClick={onMaximize}
            title={isMaximized ? '还原窗口' : '最大化窗口'}
            widthClassName="w-11"
          >
            {isMaximized ? (
              <Copy aria-hidden="true" className="size-3.5" />
            ) : (
              <Square aria-hidden="true" className="size-3" />
            )}
          </WindowControlButton>

          <WindowControlButton
            ariaLabel="关闭"
            close
            onClick={onClose}
            title="关闭"
            widthClassName="w-12"
          >
            <X aria-hidden="true" className="size-4" />
          </WindowControlButton>
        </div>
      </div>
    </div>
  )
}

interface WindowControlButtonProps {
  readonly ariaLabel: string
  readonly children: ReactNode
  readonly onClick: () => void
  readonly title: string
  readonly widthClassName: string
  readonly disabled?: boolean
  readonly disabledTitle?: string
  readonly close?: boolean
}

function WindowControlButton({
  ariaLabel,
  children,
  onClick,
  title,
  widthClassName,
  disabled = false,
  disabledTitle,
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
        widthClassName,
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
      title={disabled ? disabledTitle : title}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}
