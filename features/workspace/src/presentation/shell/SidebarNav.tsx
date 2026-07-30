import { Message } from '@mynaui/icons-react'
import type { WorkspaceSurfaceId } from '@poietica/features-workspace'
import { cn } from '@poietica/foundations-design-system'
import {
  describeWorkspaceSurface,
  type SurfaceIcon,
  WORKSPACE_NAVIGATION_ORDER,
} from './surface-registry'

export interface SidebarNavProps {
  /** 当前高亮的导航项，等于当前活动表面；非表面形态为 null。 */
  readonly activeNavigationId: WorkspaceSurfaceId | null
  readonly onSurfaceActivate: (surfaceId: WorkspaceSurfaceId) => void
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
  onCreateConversation,
}: SidebarNavProps) {
  return (
    <nav aria-label="主导航" className="workspace-sidebar__nav shrink-0 pb-1 pt-2">
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
            label={describeWorkspaceSurface('ai').title}
            onClick={onCreateConversation}
          />
        </li>

        {WORKSPACE_NAVIGATION_ORDER.map((surfaceId) => {
          const { title, icon } = describeWorkspaceSurface(surfaceId)

          return (
            <li key={surfaceId}>
              <NavRow
                active={surfaceId === activeNavigationId}
                icon={icon}
                label={title}
                onClick={() => {
                  onSurfaceActivate(surfaceId)
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
        'sidebar-nav-row text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
        active && 'bg-sidebar-accent text-foreground',
      )}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="sidebar-nav-row__icon" />

      <span className="truncate font-medium">{label}</span>
    </button>
  )
}
