import { BookOpen, Code, CogFour, Download, QuestionCircle } from '@mynaui/icons-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GithubMark,
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
       * 此前是 w-56（224px），空掉将近三分之一。macOS 菜单、Fluent MenuFlyout、
       * VS Code 的 context menu 都是 min-width 兜底 + 内容撑开，没有一个定宽。
       *
       * 尾部箭头删掉之后，一行里确定的部分只剩 popup padding 4×2 + item px 8×2
       * + 图标 16 + gap 8 = 48px，加最长标签「开发者工具」约 70px 是 118px ——
       * 低于基元 min-w-32 的 128px。也就是说宽度现在由那条兜底决定，不由内容
       * 决定；这条注释记的是事实，不是意图。
       *
       * sideOffset 也删了：基元默认 6，此处此前局部覆写成 8，没有理由。
       *
       * 分隔线切在「离开应用 / 作用于应用」的边界上。此前它切在第 2 与第 3 行
       * 之间，而外链箭头出现在第 1、2、3 行 —— Discord 与上面两个同类，被分隔线
       * 拆开了，反倒和唯一的本地动作绑在一起。
       */}
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuGroup>
          <HelpMenuItem icon={BookOpen} label="项目文档" />

          {/* Download 而不是 RefreshAlt：这一行的动作是取回，不是重载。 */}
          <HelpMenuItem icon={Download} label="检查更新" />

          {/*
           * 品牌标记，不是形近的 UI 字形。此前这里是 Message（对话气泡）—— 那不
           * 是 GitHub 的图标，只是一个语义相近的字形在凑数。
           */}
          <HelpMenuItem icon={GithubMark} label="GitHub" />
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
  readonly onClick?: () => void
}

function HelpMenuItem({ label, icon: Icon, onClick }: HelpMenuItemProps) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <Icon aria-hidden="true" className="text-muted-foreground" />

      {/*
       * 一行只有图标与标签。
       *
       * 此前每个外链行尾还挂一个 ExternalLink 箭头。连着三行都有同一个记号，等
       * 于没有记号 —— macOS 的帮助菜单、Windows 设置里的链接项都不逐行打它。箭头
       * 走了之后 external 只剩一个取值，prop 与分支一起走。
       *
       * 标签上的 flex-1 也去掉了：它当初只是为了把箭头顶到右边。
       */}
      <span>{label}</span>
    </DropdownMenuItem>
  )
}
