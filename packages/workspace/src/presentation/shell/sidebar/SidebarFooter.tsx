import {
  BookOpen,
  Code,
  CogFour,
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
} from '@poietica/ui'

import type { ReactNode } from 'react'

import type { SurfaceIcon } from '../surface-registry'

export interface SidebarFooterProps {
  /**
   * 底部行左端的插槽，排在帮助按钮之前。
   *
   * 是插槽而不是一个具体控件：这一层不认识"更新"这件事，正如它不认识助手面板
   * （见 contracts/shell.ts 里 sidebarPanel 那段）。具体节点由 apps 组合根注入。
   */
  readonly leading?: ReactNode
  readonly onSettingsOpen: () => void
  readonly onDeveloperToolsOpen: () => void
  /**
   * 当前是否停留在设置界面。
   *
   * 设置界面会盖住侧边栏，所以唯一看得见的齿轮是设置导航底部复用的这一个，
   * 它在设置里保持背景亮起 —— 和导航项的选中态同一套视觉。
   */
  readonly settingsActive?: boolean
}

/**
 * 侧边栏底部行。
 *
 * Poietica 是本地优先产品，没有登录账号，因此左侧刻意留空 —— 不放占位头像、
 * 不放假的套餐名。右下角是全局入口（帮助 + 设置），它们原先挂在图标 rail 的
 * 底部，rail 移除后由这里承接，入口数量不变。
 */
export function SidebarFooter({
  leading,
  onSettingsOpen,
  onDeveloperToolsOpen,
  settingsActive = false,
}: SidebarFooterProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
      <div aria-hidden="true" className="flex-1" />

      {leading}

      <HelpMenu onDeveloperToolsOpen={onDeveloperToolsOpen} />

      <FooterButton active={settingsActive} icon={CogFour} label="设置" onClick={onSettingsOpen} />
    </div>
  )
}

interface FooterButtonProps {
  readonly label: string
  readonly icon: SurfaceIcon
  readonly onClick: () => void
  readonly active?: boolean
}

function FooterButton({ label, icon: Icon, onClick, active = false }: FooterButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={`size-7 hover:bg-sidebar-accent hover:text-foreground ${
            active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground'
          }`}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-4" />
        </Button>
      </TooltipTrigger>

      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function HelpMenu({ onDeveloperToolsOpen }: { readonly onDeveloperToolsOpen: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="帮助"
        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-foreground"
      >
        <QuestionCircle aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56" side="top" sideOffset={8}>
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
