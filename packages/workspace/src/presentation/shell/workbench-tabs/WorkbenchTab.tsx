import { X } from '@mynaui/icons-react'
import type { KeyboardEvent } from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../../contracts/workbench'
import { describeWorkspaceSurface, type SurfaceIcon } from '../surface-registry'
import type { WorkbenchTabReorderBindings } from './use-workbench-tabs-interactions'
import { encodeWorkbenchTabDomId } from './workbench-tabs-model'

interface WorkbenchTabProps {
  readonly model: WorkbenchTabViewModel

  readonly targetIndex: number

  readonly reorder: WorkbenchTabReorderBindings

  readonly isDragging: boolean

  readonly dropSide: 'before' | 'after' | null

  readonly onActivate: (tabId: WorkbenchTabId) => void

  readonly onRequestClose: (tabId: WorkbenchTabId) => void

  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tabId: WorkbenchTabId) => void

  readonly registerTab: (tabId: WorkbenchTabId, element: HTMLButtonElement | null) => void
}

export function WorkbenchTab({
  model,
  targetIndex,
  reorder,
  isDragging,
  dropSide,
  onActivate,
  onRequestClose,
  onKeyDown,
  registerTab,
}: WorkbenchTabProps) {
  const Icon = resolveTabIcon(model)

  const encodedId = encodeWorkbenchTabDomId(model.id)

  /*
   * role="presentation"：tablist 的拥有元素必须是 tab。这层容器只承载几何与
   * 指针会话，把它从无障碍树里透明化，内层 role="tab" 才是 tablist 的子元素。
   *
   * 指针捕获挂在这一层，所以拖动越过其它标签时事件仍然回到这里。
   *
   * 捕获在越过拖拽阈值时才建立。原先在 pointerdown 就抢捕获，而捕获期间
   * mousedown 与 mouseup 都被重定向到捕获元素，click 于是在这个没有 onClick 的
   * 容器上派发，内层的激活按钮与关闭按钮双双收不到点击——此处原本有一句断言
   * “click 不受指针捕获影响”，它是错的。
   */
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 这一层只承载几何与指针捕获会话，tablist 的可聚焦项必须是内层 role="tab" 按钮；给它一个交互 role 会多出一个假的 tab。
    <div
      className="chrome-workbench-tab"
      data-active={model.isActive ? 'true' : 'false'}
      {...(isDragging ? { 'data-dragging': 'true' } : {})}
      {...(dropSide ? { 'data-drop-side': dropSide } : {})}
      onLostPointerCapture={reorder.onLostPointerCapture}
      onMouseDown={(event) => {
        if (event.button === 1 && model.canClose) {
          event.preventDefault()

          onRequestClose(model.id)
        }
      }}
      onPointerCancel={reorder.onPointerCancel}
      onPointerDown={(event) => {
        reorder.onPointerDown(event, model, targetIndex)
      }}
      onPointerLeave={(event) => {
        event.currentTarget.removeAttribute('data-suppress-hover')

        reorder.onPointerLeave(event)
      }}
      onPointerMove={reorder.onPointerMove}
      onPointerUp={reorder.onPointerUp}
      role="presentation"
    >
      <div aria-hidden="true" className="chrome-workbench-tab__active-shape">
        <ActiveTabCap side="left" />

        <span className="chrome-workbench-tab__active-center" />

        <ActiveTabCap side="right" />
      </div>

      <span aria-hidden="true" className="chrome-workbench-tab__separator" />

      <div className="chrome-workbench-tab__content">
        <button
          aria-selected={model.isActive}
          className="chrome-workbench-tab__activation"
          id={`workbench-tab-${encodedId}`}
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
    </div>
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

  return (
    <div className="chrome-workbench-tab__end">
      <button
        aria-label={`关闭 ${model.title}`}
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

/*
 * 活动标签页的左右圆角轮廓是同一条路径，左右差异由 CSS 镜像。装饰性图形显式
 * aria-hidden，不用 <title> —— <title> 在浏览器里会渲染成原生 tooltip。
 */
function ActiveTabCap({ side }: { readonly side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      className={`chrome-workbench-tab__active-cap chrome-workbench-tab__active-cap--${side}`}
      preserveAspectRatio="xMinYMin meet"
      viewBox="0 0 20 32"
    >
      <path
        className="chrome-workbench-tab__active-cap-fill"
        d="M0 32C5.5 32 9.5 28 9.5 23V10C9.5 5.6 13.1 2 17.5 2H20V32Z"
      />

      <path
        className="chrome-workbench-tab__active-cap-outline"
        d="M0 31.5C5.5 31.5 9.5 27.7 9.5 23V10C9.5 5.9 13.1 2.5 17.5 2.5H20"
      />
    </svg>
  )
}

function resolveTabIcon(model: WorkbenchTabViewModel): SurfaceIcon {
  /* 对话标签沿用 AI 表面的图标：同一个目标只允许有一个样子。 */
  if (model.kind === 'conversation') {
    return describeWorkspaceSurface('ai').icon
  }

  return describeWorkspaceSurface(model.surfaceId).icon
}
