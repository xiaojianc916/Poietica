import './properties-inspector.css'
import { ScrollArea } from '@poietica/design-system'
import type { ReactNode } from 'react'

export interface InspectorHostProps {
  readonly children: ReactNode
}

/**
 * 只拥有右栏布局和滚动。
 *
 * Editor 状态、样式相关性和对象操作均由
 * tldraw StylePanel slot 提供。
 */
export function InspectorHost({ children }: InspectorHostProps) {
  return (
    <aside
      aria-label="属性检查器"
      className="flex h-full min-h-0 min-w-0 flex-col border-l border-divider bg-sidebar"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="hc-properties-inspector-host">{children}</div>
      </ScrollArea>
    </aside>
  )
}
