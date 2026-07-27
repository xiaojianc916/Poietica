import { Message } from '@mynaui/icons-react'
import { cn } from '@poietica/foundations-design-system'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import {
  describeWorkspaceSurface,
  type SurfaceIcon,
  WORKSPACE_NAVIGATION_ORDER,
} from './surface-registry'

export interface SidebarNavProps {
  readonly activeSurfaceId: WorkspaceSurfaceId
  readonly onSurfaceActivate: (surfaceId: WorkspaceSurfaceId) => void
  readonly onCreateConversation: () => void
}

/**
 * 侧边栏顶部导航。
 *
 * 取代原先的窄图标 rail：同一列内的文字 + 图标条目，不再有独立的图标栏。
 *
 * 标题与图标一律来自 surface 注册表，这里不维护第二份 id → 展示 映射。
 * 「新建对话」是唯一的例外，因为它是动作而非 surface。
 */
export function SidebarNav({
  activeSurfaceId,
  onSurfaceActivate,
  onCreateConversation,
}: SidebarNavProps) {
  return (
    <nav aria-label="主导航" className="shrink-0 px-2 pb-1 pt-2">
      <ul className="flex flex-col gap-px">
        <li>
          <NavRow icon={Message} label="新建对话" onClick={onCreateConversation} />
        </li>

        {WORKSPACE_NAVIGATION_ORDER.map((surfaceId) => {
          const { title, icon } = describeWorkspaceSurface(surfaceId)

          return (
            <li key={surfaceId}>
              <NavRow
                active={surfaceId === activeSurfaceId}
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
        'flex h-[var(--ui-control-height-sm)] w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
        active && 'bg-sidebar-accent text-foreground',
      )}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />

      <span className="truncate font-medium">{label}</span>
    </button>
  )
}
