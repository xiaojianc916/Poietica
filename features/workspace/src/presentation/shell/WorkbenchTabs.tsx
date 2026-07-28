import { Plus } from '@mynaui/icons-react'
import type { WorkbenchTabId } from '@poietica/agent-protocol'
import type { WorkbenchTabViewModel } from '@poietica/features-workspace/contracts'
import { useCallback, useMemo, useRef } from 'react'
import { useWorkbenchTabsInteractions } from './workbench-tabs/use-workbench-tabs-interactions'
import { useWorkbenchTabsViewport } from './workbench-tabs/use-workbench-tabs-viewport'
import { WorkbenchTab } from './workbench-tabs/WorkbenchTab'

import './chrome-workbench-tabs.css'

export interface WorkbenchTabsProps {
  readonly tabs: readonly WorkbenchTabViewModel[]

  readonly onActivate: (tabId: WorkbenchTabId) => void

  readonly onClose: (tabId: WorkbenchTabId) => void

  readonly onMove: (tabId: WorkbenchTabId, targetIndex: number) => void

  readonly onCreate: () => void
}

export function WorkbenchTabs({ tabs, onActivate, onClose, onMove, onCreate }: WorkbenchTabsProps) {
  const newTabRef = useRef<HTMLButtonElement | null>(null)

  const activeTabId = tabs.find((tab) => tab.isActive)?.id

  const tabsGeometryKey = useMemo(
    () => tabs.map((tab) => [tab.id, tab.title].join(':')).join('|'),
    [tabs],
  )

  const viewport = useWorkbenchTabsViewport({
    activeTabId,
    tabsGeometryKey,
  })

  const focusNewTab = useCallback(() => {
    newTabRef.current?.focus()
  }, [])

  const interactions = useWorkbenchTabsInteractions({
    tabs,
    onActivate,
    onClose,
    onMove,
    getTabElement: viewport.getTabElement,
    focusNewTab,
  })

  /*
   * 三个兄弟节点，一层嵌套。
   *
   * role="tablist" 只拥有标签：新建按钮和拖拽填充区都不是 tab，留在里面会让
   * 屏幕阅读器把它们报成标签集合的成员。基线不归这里画——它是 chrome 行的
   * 边界，标签条只在激活标签的区间把它盖住，坐标由视口 hook 写成根元素上的
   * --chrome-active-tab-left / --chrome-active-tab-right 两个自定义属性。
   *
   * 滚动容器按内容取宽、可压缩：标签少时新建按钮紧跟最后一个标签，标签溢出时
   * 它自然停在右端——原先靠 position: sticky 加不透明底色模拟的效果，现在是
   * 布局的自然结果。
   */
  return (
    <div className="chrome-workbench-tabs" ref={viewport.stripRef}>
      <div
        aria-label="工作台标签页"
        className="chrome-workbench-tabs__scroller"
        onWheel={viewport.onWheel}
        ref={viewport.scrollerRef}
        role="tablist"
      >
        {tabs.map((tab, index) => (
          <WorkbenchTab
            dropSide={
              interactions.reorderState.insertion?.targetId === tab.id
                ? interactions.reorderState.insertion.side
                : null
            }
            isDragging={interactions.reorderState.draggingTabId === tab.id}
            key={tab.id}
            model={tab}
            onActivate={onActivate}
            onKeyDown={interactions.onKeyDown}
            onRequestClose={interactions.requestClose}
            registerTab={viewport.registerTab}
            reorder={interactions.reorder}
            targetIndex={index}
          />
        ))}
      </div>

      <button
        aria-label="新建画布"
        className="chrome-workbench-tabs__new-tab"
        onClick={onCreate}
        ref={newTabRef}
        type="button"
      >
        <Plus aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}
