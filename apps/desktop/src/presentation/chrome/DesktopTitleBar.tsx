import { Button, cn } from '@poietica/design-system'
import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from '@mynaui/icons-react'
import type { MouseEvent, ReactNode } from 'react'

const WINDOW_DRAG_EXCLUSION_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[data-window-drag-exclude]',
].join(',')

export interface DesktopTitleBarProps {
  readonly children: ReactNode
  readonly onMinimize: () => void
  readonly onMaximize: () => void
  readonly onClose: () => void
  readonly onStartDragging: () => void
  readonly onSidebarToggle: () => void
  readonly isSidebarOpen: boolean
  readonly isMaximized: boolean
  readonly sidebarWidth: number
  readonly windowControlsDisabled?: boolean
  readonly windowDraggingDisabled?: boolean
}

/**
 * Desktop platform chrome.
 *
 * Window semantics and platform-specific visuals
 * remain local to the desktop application. Generic
 * button, focus and disabled behavior come from the
 * shared design system.
 */
export function DesktopTitleBar({
  children,
  onMinimize,
  onMaximize,
  onClose,
  onStartDragging,
  onSidebarToggle,
  isSidebarOpen,
  isMaximized,
  windowControlsDisabled = false,
  windowDraggingDisabled = false,
}: DesktopTitleBarProps) {
  function handleDragMouseDown(event: MouseEvent<HTMLElement>) {
    if (windowDraggingDisabled || event.button !== 0) {
      return
    }

    const target = event.target

    if (!(target instanceof Element) || target.closest(WINDOW_DRAG_EXCLUSION_SELECTOR)) {
      return
    }

    event.preventDefault()

    if (event.detail === 2) {
      if (!windowControlsDisabled) {
        onMaximize()
      }

      return
    }

    onStartDragging()
  }

  return (
    <div className={cn('flex h-full', 'min-h-0 min-w-0', 'bg-chrome')}>
      <div
        aria-label="窗口标题栏"
        className={cn('flex h-full', 'min-h-0 w-full', 'items-stretch')}
        onMouseDownCapture={handleDragMouseDown}
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
