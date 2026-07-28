import { Message } from '@mynaui/icons-react'
import type { WorkspaceSurfaceId } from '@poietica/features-workspace'
import { cn } from '@poietica/foundations-design-system'
import {
  CANVAS_START_NAV_ID,
  describeWorkspaceNavigation,
  type SurfaceIcon,
  WORKSPACE_NAVIGATION_ORDER,
  type WorkspaceNavigationId,
} from './surface-registry'

export interface SidebarNavProps {
  /** 当前高亮的导航项。画布态为 null——画布是文档，不是导航目的地。 */
  readonly activeNavigationId: WorkspaceNavigationId | null
  readonly onSurfaceActivate: (surfaceId: WorkspaceSurfaceId) => void
  readonly onCanvasStartActivate: () => void
  readonly onCreateConversation: () => void
}

/**
 * 侧边栏顶部导航。
 *
 * 标题与图标一律来自导航描述表，这里不维护第二份 id → 展示 映射。
 * 「新建对话」是唯一的例外，因为它是动作而非导航目标。
 */
export function SidebarNav({
  activeNavigationId,
  onSurfaceActivate,
  onCanvasStartActivate,
  onCreateConversation,
}: SidebarNavProps) {
  return (
    <nav aria-label="主导航" className="shrink-0 px-1 pb-1 pt-2">
      <ul className="flex flex-col gap-px">
        {/*
         * 「新建对话」是动作而非表面，但它打开的就是 ai 表面，所以选中态直接由
         * 当前导航项推出，并且走与其余导航项同一个 NavRow 的 active——高亮只有
         * 一处真相，不会出现两个导航项同时亮或都不亮。
         */}
        <li>
          <NavRow
            active={activeNavigationId === 'ai'}
            icon={Message}
            label={describeWorkspaceNavigation('ai').title}
            onClick={onCreateConversation}
          />
        </li>

        {WORKSPACE_NAVIGATION_ORDER.map((navigationId) => {
          const { title, icon } = describeWorkspaceNavigation(navigationId)

          return (
            <li key={navigationId}>
              <NavRow
                active={navigationId === activeNavigationId}
                icon={icon}
                label={title}
                onClick={() => {
                  if (navigationId === CANVAS_START_NAV_ID) {
                    onCanvasStartActivate()
                    return
                  }

                  onSurfaceActivate(navigationId)
                }}
              />
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

interface NavRowProps {
  readonly label: string
  readonly icon: SurfaceIcon
  readonly active?: boolean
  readonly onClick: () => void
}

function NavRow({ label, icon: Icon, active = false, onClick }: NavRowProps) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[var(--ui-control-height-sm)] w-full items-center gap-2 rounded-md pr-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
        active && 'bg-sidebar-accent text-foreground',
      )}
      onClick={onClick}
      /*
       * 图标中线锚在 --workspace-sidebar-nav-icon-center 上：4px 是 nav 的
       * px-1（留给行悬浮背景的外边距），8px 是 16px 图标的一半。
       */
      style={{ paddingLeft: 'calc(var(--workspace-sidebar-nav-icon-center) - 4px - 8px)' }}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />

      <span className="truncate font-medium">{label}</span>
    </button>
  )
}
