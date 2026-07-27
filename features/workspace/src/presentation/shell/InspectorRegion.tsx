import { PanelRightClose, PanelRightOpen } from '@mynaui/icons-react'
import { Button } from '@poietica/foundations-design-system'
import type { ReactNode } from 'react'

export interface InspectorRegionProps {
  readonly isDocked: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: ReactNode
}

/**
 * 属性检查器区域。
 *
 * 栅格列宽由 WorkspaceFrame 的动画拥有；这里只负责裁剪视口与开合控件。
 *
 * 开合是**一个** toggle，不是"展开按钮 + 收起按钮"两个控件：辅助技术看到的
 * 状态与用户心智一致，aria-expanded 也只有一处真相。它的横向位置绑定动画
 * 变量 --workspace-inspector-column-width，因此会跟着面板一起滑动而不是瞬移。
 */
export function InspectorRegion({ isDocked, onOpenChange, children }: InspectorRegionProps) {
  return (
    <>
      <aside
        aria-hidden={!isDocked}
        aria-label="属性检查器"
        className="relative row-[2/-1] min-h-0 min-w-0 overflow-visible"
        style={{
          gridColumn: 3,
          pointerEvents: isDocked ? 'auto' : 'none',
        }}
      >
        <div className="relative h-full min-h-0 w-full overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-[var(--inspector-width)]">{children}</div>
        </div>
      </aside>

      <Button
        aria-expanded={isDocked}
        aria-label={isDocked ? '收起属性面板' : '展开属性面板'}
        className="absolute top-[calc(var(--chrome-height)+12px)] z-30 size-7 rounded-r-none"
        onClick={() => {
          onOpenChange(!isDocked)
        }}
        size="icon"
        style={{ right: 'var(--workspace-inspector-column-width, 0px)' }}
        type="button"
        variant="outline"
      >
        {isDocked ? (
          <PanelRightClose aria-hidden="true" className="size-3.5" />
        ) : (
          <PanelRightOpen aria-hidden="true" className="size-3.5" />
        )}
      </Button>
    </>
  )
}
