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

/*
 * 仓库地址。
 *
 * 与 apps/desktop/src-tauri/tauri.conf.json 的 bundle.homepage 是同一个串。这
 * 是分层的代价而不是疏忽：这个包在第 4 层，读不到 apps 里的构建配置，而把它
 * 做成 prop 从组合根传下来，等于为一个常量铺一条跨三层的通道。两处任一改动，
 * 另一处要跟着改。
 */
const REPOSITORY_URL = 'https://github.com/xiaojianc916/poietica'

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
       * 一条下限，不是一个定值。
       *
       * 这两件事此前被混为一谈。w-56 是 width: 224px —— 内容再长不长、再短不缩，
       * 于是空掉将近三分之一，那种写法是错的。min-width 是下限：内容短的时候撑
       * 住场面，长的时候让路。macOS 菜单、Fluent MenuFlyout、VS Code 的 context
       * menu 用的都是「下限 + 内容撑开」这一组，不是定值。
       *
       * 为什么基元那条下限不够：尾部箭头删掉之后，一行里确定的部分只剩 popup
       * padding 4×2 + item px 8×2 + 图标 16 + gap 8 = 48px，加最长标签「开发者
       * 工具」约 70px 是 118px，低于 min-w-32 的 128px。而这个菜单有 4 行 × 32
       * + 分隔 9 + padding 8 = 145px 高 —— 比高还窄。菜单是横向阅读的东西。
       *
       * 168px 这个数不是新发明的：composer-metrics.css 里的 --cp-menu-min 就是
       * 168px，是应用里唯一已有的菜单下限。再取一个 192 或 200 就是第三份真相。
       * 与 popup-surface.ts 里那句「等到主题层收口时再合并成一处声明」同一个处
       * 置办法：先同数，收口时一起变成令牌。
       *
       * Tailwind v4 的间距刻度是 0.25rem，42 × 4 = 168，在刻度上，不必写
       * min-w-[168px] 这种脱轨值。
       *
       * sideOffset 也删了：基元默认 6，此处此前局部覆写成 8，没有理由。
       *
       * 分隔线切在「离开应用 / 作用于应用」的边界上。此前它切在第 2 与第 3 行
       * 之间，而外链箭头出现在第 1、2、3 行 —— Discord 与上面两个同类，被分隔线
       * 拆开了，反倒和唯一的本地动作绑在一起。
       */}
      <DropdownMenuContent align="end" className="min-w-40" side="top">
        <DropdownMenuGroup>
          <HelpMenuItem icon={BookOpen} label="项目文档" />

          {/* Download 而不是 RefreshAlt：这一行的动作是取回，不是重载。 */}
          <HelpMenuItem icon={Download} label="检查更新" />

          {/*
           * 品牌标记，不是形近的 UI 字形。此前这里是 Message（对话气泡）—— 那不
           * 是 GitHub 的图标，只是一个语义相近的字形在凑数。
           */}
          <HelpMenuItem href={REPOSITORY_URL} icon={GithubMark} label="GitHub" />
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
  /**
   * 外链行给一个真的 href。
   *
   * 不是 onClick 回调，也不需要从组合根往下传任何东西：apps/desktop 已经在
   * document 上装了一条 capture 阶段的监听（presentation/chrome/external-links
   * .ts），凡是 a[href] 且协议是 http(s)/mailto 就拦下来交给系统浏览器。此前
   * 这一行点了没反应，原因是 Base UI 的 Menu.Item 渲染出来是个 div —— 那条监
   * 听的 a[href] 判断压根匹配不到它。
   *
   * 于是这一层只需要说清「它是一条链接」这个事实，跨进程那一半归 apps。两边
   * 谁也不必知道对方存在，这个包（第 4 层）也就不必认识 Tauri。
   */
  readonly href?: string
  readonly onClick?: () => void
}

function HelpMenuItem({ label, icon: Icon, href, onClick }: HelpMenuItemProps) {
  return (
    /*
     * 这个 <a> 必须内联写在属性值上，不能先提到一个 const 里。
     *
     * useAnchorContent 的文档里最后一条有效示例逐字就是这个形状：
     *   <Button render={<a href="/home" aria-label="Home" />}>Home</Button>
     * 规则对「自定义组件上的这类 prop」自带豁免，理由写在文档里 —— 组件可能把
     * 锚点当成内容外壳，链接文字由 children 提供。这里正是如此：图标与标签由
     * 下面两行给出，Base UI 会把它们放进这个 <a> 里。
     *
     * 提到 const 之后 biome 看见的就只是一个孤立的空锚点，它没有任何办法知道
     * 这个元素最后落在哪里，于是豁免不成立 —— 上一轮那条 error 就是这么来的。
     * 修法不是补一个 aria-label（那会用一个重复的串盖掉真正的可访问名），也不
     * 是 biome-ignore，而是把元素放回它本来该在的位置。
     *
     * href 为空时给 <div /> —— 那就是 Menu.Item 的默认元素，一个空操作。
     */
    <DropdownMenuItem
      onClick={onClick}
      render={href === undefined ? <div /> : <a href={href} rel="noreferrer" />}
    >
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
