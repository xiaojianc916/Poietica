import { Plus } from '@mynaui/icons-react'
import { useCallback, useMemo, useRef } from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../contracts/workbench-contract'
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

  return (
    <div className="chrome-workbench-tabs">
      <div
        className="chrome-workbench-tabs__viewport"
        data-has-active-tab={activeTabId ? 'true' : 'false'}
        ref={viewport.viewportRef}
      >
        <div
          aria-label="工作台标签页"
          className="chrome-workbench-tabs__scroller"
          onWheel={viewport.onWheel}
          ref={viewport.scrollerRef}
          role="tablist"
        >
          {tabs.map((tab, index) => (
            <WorkbenchTab
              drag={interactions.drag}
              key={tab.id}
              model={tab}
              onActivate={onActivate}
              onKeyDown={interactions.onKeyDown}
              onRequestClose={interactions.requestClose}
              registerTab={viewport.registerTab}
              targetIndex={index}
            />
          ))}

          <button
            aria-label="新建画布"
            className={[
              'chrome-workbench-tabs__new-tab',
              'chrome-workbench-tabs__new-tab--sticky',
            ].join(' ')}
            data-window-drag-exclude
            onClick={onCreate}
            ref={newTabRef}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>

          <div
            aria-hidden="true"
            className="chrome-workbench-tabs__drag-region"
            data-window-drag-region
          />
        </div>
      </div>
    </div>
  )
}
