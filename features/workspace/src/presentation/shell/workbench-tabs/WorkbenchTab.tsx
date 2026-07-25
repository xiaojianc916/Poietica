import { FilePlus, FileText, X } from '@mynaui/icons-react'
import type { ComponentType, DragEvent, KeyboardEvent } from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../../contracts/workbench-contract'
import type { WorkbenchTabDragBindings } from './use-workbench-tabs-interactions'
import { describeWorkspaceSurface } from '../surface-registry'
import { encodeWorkbenchTabDomId } from './workbench-tabs-model'

type TabIcon = ComponentType<{
  readonly className?: string

  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}>

interface WorkbenchTabProps {
  readonly model: WorkbenchTabViewModel

  readonly targetIndex: number

  readonly drag: WorkbenchTabDragBindings

  readonly onActivate: (tabId: WorkbenchTabId) => void

  readonly onRequestClose: (tabId: WorkbenchTabId) => void

  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tabId: WorkbenchTabId) => void

  readonly registerTab: (tabId: WorkbenchTabId, element: HTMLButtonElement | null) => void
}

export function WorkbenchTab({
  model,
  targetIndex,
  drag,
  onActivate,
  onRequestClose,
  onKeyDown,
  registerTab,
}: WorkbenchTabProps) {
  const Icon = resolveTabIcon(model)

  const encodedId = encodeWorkbenchTabDomId(model.id)

  return (
    <article
      className="chrome-workbench-tab"
      data-active={model.isActive ? 'true' : 'false'}
      draggable={model.canClose}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDragStart={(event) => {
        drag.onDragStart(event, model)
      }}
      onDrop={(event) => {
        drag.onDrop(event, targetIndex)
      }}
      onMouseDown={(event) => {
        if (event.button === 1 && model.canClose) {
          event.preventDefault()

          onRequestClose(model.id)
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
          aria-selected={model.isActive}
          className="chrome-workbench-tab__activation"
          id={'workbench-tab-' + encodedId}
          onClick={() => {
            onActivate(model.id)
          }}
          onKeyDown={(event) => {
            onKeyDown(event, model.id)
          }}
          ref={(element) => {
            registerTab(model.id, element)
          }}
          role="tab"
          tabIndex={model.isActive ? 0 : -1}
          title={model.title}
          type="button"
        >
          <Icon aria-hidden="true" className="chrome-workbench-tab__icon" />

          <span className="chrome-workbench-tab__title">{model.title}</span>
        </button>

        <TabEndAction model={model} onRequestClose={onRequestClose} />
      </div>
    </article>
  )
}

function TabEndAction({
  model,
  onRequestClose,
}: {
  readonly model: WorkbenchTabViewModel

  readonly onRequestClose: (tabId: WorkbenchTabId) => void
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
          className={[
            'chrome-workbench-tab__status',
            'chrome-workbench-tab__status--' + status,
          ].join(' ')}
          role="status"
        />
      ) : null}

      <button
        aria-label={'关闭 ' + model.title}
        className="chrome-workbench-tab__close"
        onClick={(event) => {
          event.stopPropagation()

          onRequestClose(model.id)
        }}
        tabIndex={-1}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

function ChromeActiveTabShape() {
  return (
    <div aria-hidden="true" className="chrome-workbench-tab__active-shape">
      <svg
        className={[
          'chrome-workbench-tab__active-cap',
          'chrome-workbench-tab__active-cap--left',
        ].join(' ')}
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
        className={[
          'chrome-workbench-tab__active-cap',
          'chrome-workbench-tab__active-cap--right',
        ].join(' ')}
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

function resolveTabIcon(model: WorkbenchTabViewModel): TabIcon {
  if (model.kind === 'start') {
    return FilePlus
  }

  if (model.kind === 'canvas') {
    return FileText
  }

  return describeWorkspaceSurface(model.surfaceId).icon
}
