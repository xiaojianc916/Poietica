import type { ReactNode } from 'react'

export interface StatusBarHostProps {
  readonly children: ReactNode
}

export function StatusBarHost({ children }: StatusBarHostProps) {
  return (
    <footer
      aria-label="画布状态栏"
      role="status"
      className="
        flex h-(--status-height) min-w-0 items-center
        border-t border-divider bg-chrome
        text-[11px] text-muted-foreground
      "
    >
      <div
        className="
          flex min-w-0 flex-1 items-center gap-1
          overflow-x-auto px-2 whitespace-nowrap
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {children}
      </div>
    </footer>
  )
}
