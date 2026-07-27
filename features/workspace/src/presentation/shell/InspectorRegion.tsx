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
 * 栅格格位与空列的指针穿透由 workspace-shell.css 拥有；列宽由 WorkspaceFrame
 * 的动画拥有。这里只负责裁剪视口与开合控件。
 *
 * 开合是一个 toggle，不是"展开按钮 + 收起按钮"两个控件：aria-expanded 只有
 * 一处真相。它的横向位置绑定动画变量，因此跟着面板滑动而不是瞬移。
 */
export function InspectorRegion({ isDocked, onOpenChange, children }: InspectorRegionProps) {
  return (
    <>
      <aside
        aria-hidden={!isDocked}
        aria-label="属性检查器"
        className="workspace-shell__inspector relative min-h-0 min-w-0 overflow-visible"
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
