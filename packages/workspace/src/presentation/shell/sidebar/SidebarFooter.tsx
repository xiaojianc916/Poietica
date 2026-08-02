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
          <Icon aria-hidden="true" />
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

      {/*
       * 不定宽：菜单由内容撑开，兜底是基元的 min-w-32。
       *
       * 此前是 w-56（224px）。最长标签「开发者工具」5 个全角字 @ 14px 约 70px，
       * 一行里确定的部分（popup padding 4×2 + item px 8×2 + 前导图标 16 + gap 8
       * + 标签与尾标间 8 + 尾标 16）是 80px，合计约 150px —— 有 74px 是空的，就是
       * 标签与右侧箭头之间那段空白。macOS 菜单、Fluent MenuFlyout、VS Code 的
       * context menu 都是 min-width 兜底 + 内容撑开，没有一个定宽。
       *
       * sideOffset 也删了：基元默认 6，此处此前局部覆写成 8，没有理由。
       *
       * 分隔线切在「离开应用 / 作用于应用」的边界上。此前它切在第 2 与第 3 行
       * 之间，而外链箭头出现在第 1、2、3 行 —— Discord 与上面两个同类，被分隔线
       * 拆开了，反倒和唯一的本地动作绑在一起。
       */}
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuGroup>
          <HelpMenuItem external icon={BookOpen} label="项目文档" />

          <HelpMenuItem external icon={RefreshAlt} label="检查更新" />

          <HelpMenuItem external icon={Message} label="Github" />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
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
      <Icon aria-hidden="true" className="text-muted-foreground" />

      <span className="flex-1">{label}</span>

      {/*
       * 直接是一个图标，不套 DropdownMenuShortcut。
       *
       * 那个组件是给 ⌘K 这类键位文本准备的：text-xs 与 tracking-widest 作用在
       * svg 上是空转，真正被用到的只有 ml-auto —— 而上面那个 flex-1 已经把尾标
       * 推到右边了，连 ml-auto 都不需要。
       *
       * 尺寸仍是 16px：tokens/controls.css 只允许 16 / 32 两档，因为 S / 16 必须
       * 在 dpr 1.5 下取整（14px → 21px 会糊）。减重交给 muted 色，不改尺寸。
       */}
      {external ? <ExternalLink aria-hidden="true" className="text-muted-foreground" /> : null}
    </DropdownMenuItem>
  )
}
