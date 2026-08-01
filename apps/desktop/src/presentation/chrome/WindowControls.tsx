import { Copy, Minus, Square, X } from '@mynaui/icons-react'
import { Button, cn } from '@poietica/ui'
import type { ReactNode } from 'react'

const WINDOW_CONTROLS_DISABLED_TITLE = '窗口控制暂时不可用'

export interface WindowControlsProps {
  readonly isMaximized: boolean
  readonly onMinimize: () => void
  readonly onMaximize: () => void
  readonly onClose: () => void
  readonly disabled?: boolean | undefined
}

/**
 * 窗口的最小化 / 最大化 / 关闭。
 *
 * 提出来是因为它有第二个使用者：应用崩溃屏。那里整条 AppShell 已经从树上消失，
 * 而窗口是无装饰的——没有这组按钮，用户除了杀进程没有别的出路。窗口控制属于
 * 非客户区，本来就不该随业务树一起死。
 *
 * 尺寸、原生红、禁用文案因此只有这一份。
 */
export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximize,
  onClose,
  disabled = false,
}: WindowControlsProps) {
  return (
    <div className="flex shrink-0 items-stretch">
      <WindowControlButton
        ariaLabel="最小化"
        disabled={disabled}
        onClick={onMinimize}
        title="最小化"
      >
        <Minus aria-hidden="true" className="size-3.5" />
      </WindowControlButton>

      <WindowControlButton
        ariaLabel={isMaximized ? '还原窗口' : '最大化窗口'}
        disabled={disabled}
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
