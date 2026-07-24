import {
  Box,
  ChartNetwork,
  ChartNoAxesCombined,
  FilePlus,
  FileText,
  FolderTwo,
  Grid,
  Image,
  LayersThree,
  Plus,
  Search,
  X,
} from '@mynaui/icons-react'

import type { ComponentType } from 'react'

import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../contracts/workbench-contract'
import { encodeWorkbenchTabDomId } from './workbench-tabs/workbench-tab-model'
import { useWorkbenchTabKeyboard } from './workbench-tabs/use-workbench-tab-keyboard'
import { useWorkbenchTabDrag } from './workbench-tabs/use-workbench-tab-drag'
import { useWorkbenchTabsViewport } from './workbench-tabs/use-workbench-tabs-viewport'

import './chrome-workbench-tabs.css'

export interface WorkbenchTabsProps {
  readonly tabs: readonly WorkbenchTabViewModel[]
  readonly onActivate: (tabId: WorkbenchTabId) => void
  readonly onClose: (tabId: WorkbenchTabId) => void
  readonly onMove: (tabId: WorkbenchTabId, targetIndex: number) => void
  readonly onCreate: () => void
}

type TabIcon = ComponentType<{
  readonly className?: string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}>

export function WorkbenchTabs({ tabs, onActivate, onClose, onMove, onCreate }: WorkbenchTabsProps) {
  const activeTabId = tabs.find((tab) => tab.isActive)?.id

  const tabViewport = useWorkbenchTabsViewport({
    activeTabId,
  })

  const handleTabKeyDown = useWorkbenchTabKeyboard({
    tabs,
    onActivate,
    onClose,
    getTabElement: tabViewport.getTabElement,
  })

  const tabDrag = useWorkbenchTabDrag({
    tabCount: tabs.length,
    onMove,
  })

  return (
    <div className="chrome-workbench-tabs">
      <div
        className="chrome-workbench-tabs__viewport"
        data-has-active-tab={activeTabId ? 'true' : 'false'}
        ref={tabViewport.viewportRef}
      >
        <div
          aria-label="工作台标签页"
          className="chrome-workbench-tabs__scroller"
          onWheel={tabViewport.onWheel}
          ref={tabViewport.scrollerRef}
          role="tablist"
        >
          {tabs.map((tab, index) => {
            const Icon = resolveTabIcon(tab)

            return (
              <article
                className="chrome-workbench-tab"
                data-active={tab.isActive ? 'true' : 'false'}
                draggable={tab.canClose}
                key={tab.id}
                onDragEnd={tabDrag.onDragEnd}
                onDragOver={tabDrag.onDragOver}
                onDragStart={(event) => tabDrag.onDragStart(event, tab)}
                onDrop={(event) => tabDrag.onDrop(event, index)}
                onMouseDown={(event) => {
                  if (event.button === 1 && tab.canClose) {
                    event.preventDefault()
                    onClose(tab.id)
                  }
                }}
                onPointerLeave={(event) => {
                  event.currentTarget.removeAttribute('data-suppress-hover')
                }}
              >
                <ChromeActiveTabShape />

                <span aria-hidden="true" className="chrome-workbench-tab__separator" />

                <div className="chrome-workbench-tab__content">
                  <button
                    aria-controls={`workbench-panel-${encodeWorkbenchTabDomId(tab.id)}`}
                    aria-selected={tab.isActive}
                    className="chrome-workbench-tab__activation"
                    id={`workbench-tab-${encodeWorkbenchTabDomId(tab.id)}`}
                    onClick={() => onActivate(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                    ref={(node) => {
                      tabViewport.registerTab(tab.id, node)
                    }}
                    role="tab"
                    tabIndex={tab.isActive ? 0 : -1}
                    title={tab.title}
                    type="button"
                  >
                    <Icon aria-hidden="true" className="chrome-workbench-tab__icon" />

                    <span className="chrome-workbench-tab__title">{tab.title}</span>
                  </button>

                  <TabEndAction model={tab} onClose={onClose} />
                </div>
              </article>
            )
          })}
          <button
            aria-label="新建画布"
            className="chrome-workbench-tabs__new-tab chrome-workbench-tabs__new-tab--sticky"
            data-window-drag-exclude
            onClick={onCreate}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>

          <div aria-hidden="true" className="chrome-workbench-tabs__drag-region" />
        </div>
      </div>
    </div>
  )
}

function ChromeActiveTabShape() {
  return (
    <div aria-hidden="true" className="chrome-workbench-tab__active-shape">
      <svg
        className="chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--left"
        preserveAspectRatio="xMinYMin meet"
        viewBox="0 0 20 32"
      >
        <title>活动标签页左侧轮廓</title>
        <path
          className="chrome-workbench-tab__active-cap-fill"
          d="M0 32C5.5 32 9.5 28 9.5 23V10C9.5 5.6 13.1 2 17.5 2H20V32Z"
        />

        <path
          className="chrome-workbench-tab__active-cap-outline"
          d="M0 31.5C5.5 31.5 9.5 27.7 9.5 23V10C9.5 5.9 13.1 2.5 17.5 2.5H20"
        />
      </svg>

      <span className="chrome-workbench-tab__active-center" />

      <svg
        className="chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--right"
        preserveAspectRatio="xMinYMin meet"
        viewBox="0 0 20 32"
      >
        <title>活动标签页右侧轮廓</title>
        <path
          className="chrome-workbench-tab__active-cap-fill"
          d="M0 32C5.5 32 9.5 28 9.5 23V10C9.5 5.6 13.1 2 17.5 2H20V32Z"
        />

        <path
          className="chrome-workbench-tab__active-cap-outline"
          d="M0 31.5C5.5 31.5 9.5 27.7 9.5 23V10C9.5 5.9 13.1 2.5 17.5 2.5H20"
        />
      </svg>
    </div>
  )
}

function TabEndAction({
  model,
  onClose,
}: {
  readonly model: WorkbenchTabViewModel
  readonly onClose: (tabId: WorkbenchTabId) => void
}) {
  if (!model.canClose) {
    return null
  }

  const status = model.kind === 'canvas' ? model.status : undefined

  return (
    <div className="chrome-workbench-tab__end">
      {status && status !== 'clean' ? (
        <span
          aria-label={status === 'dirty' ? '未保存' : status === 'saving' ? '正在保存' : '保存失败'}
          className={`chrome-workbench-tab__status chrome-workbench-tab__status--${status}`}
          role="status"
        />
      ) : null}

      <button
        aria-label={`关闭 ${model.title}`}
        className="chrome-workbench-tab__close"
        onClick={(event) => {
          event.stopPropagation()
          onClose(model.id)
        }}
        tabIndex={-1}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

function resolveTabIcon(model: WorkbenchTabViewModel): TabIcon {
  if (model.kind === 'start') {
    return FilePlus
  }

  if (model.kind === 'canvas') {
    return FileText
  }

  switch (model.surfaceId) {
    case 'pages':
      return Grid
    case 'documents':
      return FolderTwo
    case 'search':
      return Search
    case 'layers':
      return LayersThree
    case 'relations':
      return ChartNetwork
    case 'data':
      return ChartNoAxesCombined
    case 'assets':
      return Image
    case 'extensions':
      return Box
  }
}
