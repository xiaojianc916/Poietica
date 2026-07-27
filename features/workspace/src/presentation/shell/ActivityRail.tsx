import {
  BookOpen,
  Code,
  Cog,
  ExternalLink,
  Message,
  QuestionCircle,
  RefreshAlt,
} from '@mynaui/icons-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@poietica/foundations-design-system'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import {
  describeWorkspaceSurface,
  type SurfaceIcon,
  WORKSPACE_NAVIGATION_ORDER,
} from './surface-registry'

export interface ActivityRailProps {
  readonly activeItemId: WorkspaceSurfaceId
  readonly onItemActivate: (surfaceId: WorkspaceSurfaceId) => void
  readonly onDeveloperToolsOpen: () => void
  readonly onSettingsOpen: () => void
}

/**
 * 主导航。
 *
 * 图标与标题一律来自 surface 注册表：这里不维护第二份 id → 展示 映射。
 */
export function ActivityRail({
  activeItemId,
  onItemActivate,
  onDeveloperToolsOpen,
  onSettingsOpen,
}: ActivityRailProps) {
  return (
    <nav aria-label="主导航" className="flex h-full min-h-0 flex-col items-center bg-sidebar py-2">
      <div className="flex flex-col gap-1">
        {WORKSPACE_NAVIGATION_ORDER.map((surfaceId) => {
          const { title, icon } = describeWorkspaceSurface(surfaceId)

          return (
            <RailButton
              active={surfaceId === activeItemId}
              icon={icon}
              key={surfaceId}
              label={title}
              onClick={() => {
                onItemActivate(surfaceId)
              }}
            />
          )
        })}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1">
        <RailButton icon={Cog} label="设置" onClick={onSettingsOpen} />

        <HelpMenu onDeveloperToolsOpen={onDeveloperToolsOpen} />
      </div>
    </nav>
  )
}

interface RailButtonProps {
  readonly label: string
  readonly icon: SurfaceIcon
  readonly active?: boolean
  readonly onClick: () => void
}

function RailButton({ label, icon: Icon, active = false, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          className={
            active
              ? 'relative size-9 bg-sidebar-accent text-muted-foreground hover:bg-sidebar-accent'
              : 'size-9 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
          }
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {active ? (
            <span aria-hidden="true" className="absolute -left-2 h-4 w-0.5 rounded-r bg-primary" />
          ) : null}

          <Icon aria-hidden="true" className="size-4" />
        </Button>
      </TooltipTrigger>

      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function HelpMenu({ onDeveloperToolsOpen }: { readonly onDeveloperToolsOpen: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="帮助"
        className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-foreground"
      >
        <QuestionCircle aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56" side="right" sideOffset={8}>
        <DropdownMenuGroup>
          <HelpMenuItem external icon={BookOpen} label="文档" />

          <HelpMenuItem external icon={RefreshAlt} label="更新日志" />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <HelpMenuItem external icon={Message} label="Discord" />

          <HelpMenuItem icon={Code} label="开发者工具" onClick={onDeveloperToolsOpen} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface HelpMenuItemProps {
  readonly label: string
  readonly icon: SurfaceIcon
  readonly external?: boolean
  readonly onClick?: () => void
}

function HelpMenuItem({ label, icon: Icon, external = false, onClick }: HelpMenuItemProps) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />

      <span className="flex-1">{label}</span>

      {external ? (
        <DropdownMenuShortcut>
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  )
}
