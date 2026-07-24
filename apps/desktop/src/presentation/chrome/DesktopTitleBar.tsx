import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from '@mynaui/icons-react'

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
  readonly children: React.ReactNode
  readonly onMinimize: () => void
  readonly onMaximize: () => void
  readonly onClose: () => void
  readonly onStartDragging: () => void
  readonly onSidebarToggle: () => void
  readonly isSidebarOpen: boolean
  readonly isMaximized: boolean
  readonly sidebarWidth: number
}

export function DesktopTitleBar({
  children,
  onMinimize,
  onMaximize,
  onClose,
  onStartDragging,
  onSidebarToggle,
  isSidebarOpen,
  isMaximized,
}: DesktopTitleBarProps) {
  function handleDragMouseDown(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return
    }

    const target = event.target

    if (!(target instanceof Element) || target.closest(WINDOW_DRAG_EXCLUSION_SELECTOR)) {
      return
    }

    event.preventDefault()

    if (event.detail === 2) {
      onMaximize()
      return
    }

    onStartDragging()
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 bg-chrome">
      <div
        aria-label="窗口标题栏"
        className="flex h-full min-h-0 w-full items-stretch"
        onMouseDownCapture={handleDragMouseDown}
        role="toolbar"
      >
        <div className="flex w-(--activity-rail-width) shrink-0 items-center justify-center border-b border-divider">
          <button
            aria-label={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={onSidebarToggle}
            type="button"
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </button>
        </div>

        <div
          className="shrink-0 border-b border-divider"
          style={{
            borderRightStyle: 'solid',
            borderRightWidth: isSidebarOpen ? 1 : 0,
            width: 'var(--workspace-sidebar-column-width, 0px)',
          }}
        />

        <div className="flex min-w-0 flex-1 items-stretch">{children}</div>

        <div className="flex shrink-0 items-stretch border-b border-divider">
          <button
            aria-label="最小化"
            className="grid w-11 place-items-center text-muted-foreground hover:bg-black/5 hover:text-foreground"
            onClick={onMinimize}
            type="button"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
            className="grid w-11 place-items-center text-muted-foreground hover:bg-black/5 hover:text-foreground"
            onClick={onMaximize}
            title={isMaximized ? '还原窗口' : '最大化窗口'}
            type="button"
          >
            {isMaximized ? (
              <Copy aria-hidden="true" className="size-3.5" />
            ) : (
              <Square aria-hidden="true" className="size-3" />
            )}
          </button>
          <button
            aria-label="关闭"
            className="grid w-12 place-items-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
