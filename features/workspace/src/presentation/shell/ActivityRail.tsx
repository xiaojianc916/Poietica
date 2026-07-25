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
import {
  BookOpen,
  Box,
  ChartNetwork,
  Code,
  Cog,
  ExternalLink,
  FolderTwo,
  Grid,
  Image,
  Message,
  QuestionCircle,
  RefreshAlt,
  Search,
} from '@mynaui/icons-react'
import type { ComponentType } from 'react'

import { AiSurfaceIcon } from './icons/AiSurfaceIcon'

type NavigationIcon = ComponentType<{
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}>

export type CanvasNavigationItemId =
  | 'pages'
  | 'documents'
  | 'search'
  | 'layers'
  | 'relations'
  | 'ai'
  | 'assets'
  | 'extensions'

export interface CanvasNavigationItem {
  readonly id: CanvasNavigationItemId
  readonly label: string
  readonly icon: NavigationIcon
}

export interface ActivityRailProps {
  readonly activeItemId?: CanvasNavigationItemId

  readonly items?: readonly CanvasNavigationItem[]

  readonly onItemActivate?: (itemId: CanvasNavigationItemId) => void

  readonly onDeveloperToolsOpen: () => void

  readonly onSettingsOpen: () => void
}

const DEFAULT_NAVIGATION: readonly CanvasNavigationItem[] = [
  {
    id: 'ai',
    label: 'AI',
    icon: AiSurfaceIcon,
  },
  {
    id: 'search',
    label: '搜索',
    icon: Search,
  },
  {
    id: 'pages',
    label: '画布',
    icon: Grid,
  },
  {
    id: 'relations',
    label: '关系',
    icon: ChartNetwork,
  },
  {
    id: 'assets',
    label: '素材',
    icon: Image,
  },
  {
    id: 'extensions',
    label: '插件',
    icon: Box,
  },
  {
    id: 'documents',
    label: '恢复',
    icon: FolderTwo,
  },
]

export function ActivityRail({
  activeItemId = 'pages',
  items = DEFAULT_NAVIGATION,
  onItemActivate,
  onDeveloperToolsOpen,
  onSettingsOpen,
}: ActivityRailProps) {
  return (
    <nav
      aria-label="主导航"
      className={['flex h-full min-h-0', 'flex-col items-center', 'bg-sidebar py-2'].join(' ')}
    >
      <div className={['flex flex-col gap-1'].join(' ')}>
        {items.map((item) => (
          <RailButton
            active={item.id === activeItemId}
            icon={item.icon}
            key={item.id}
            label={item.label}
            onClick={() => {
              onItemActivate?.(item.id)
            }}
          />
        ))}
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
  readonly icon: NavigationIcon
  readonly active?: boolean
  readonly onClick?: () => void
}

function RailButton({ label, icon: Icon, active = false, onClick }: RailButtonProps) {
  const className = active
    ? [
        'relative size-9',
        'bg-sidebar-accent',
        'text-muted-foreground',
        'hover:bg-sidebar-accent',
      ].join(' ')
    : ['size-9', 'text-muted-foreground', 'hover:bg-sidebar-accent', 'hover:text-foreground'].join(
        ' ',
      )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          className={className}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {active ? (
            <span
              aria-hidden="true"
              className={['absolute -left-2', 'h-4 w-0.5', 'rounded-r', 'bg-primary'].join(' ')}
            />
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
        className={[
          'grid size-9 place-items-center',
          'rounded-md',
          'text-muted-foreground',
          'transition-colors',
          'hover:bg-sidebar-accent',
          'hover:text-foreground',
          'data-[popup-open]:bg-sidebar-accent',
          'data-[popup-open]:text-foreground',
        ].join(' ')}
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
  readonly icon: NavigationIcon
  readonly external?: boolean
  readonly disabled?: boolean
  readonly onClick?: () => void
}

function HelpMenuItem({
  label,
  icon: Icon,
  external = false,
  disabled = false,
  onClick,
}: HelpMenuItemProps) {
  return (
    <DropdownMenuItem disabled={disabled} onClick={onClick}>
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
