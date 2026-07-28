import { PanelLeftClose, PanelLeftOpen } from '@mynaui/icons-react'
import { Button } from '@poietica/foundations-design-system'
import type { ReactNode } from 'react'
import { WindowControls } from './WindowControls'

export interface DesktopTitleBarProps {
  readonly children: ReactNode
  readonly onMinimize: () => void
  readonly onMaximize: () => void
  readonly onClose: () => void
  readonly onSidebarToggle: () => void
  readonly isSidebarOpen: boolean
  readonly isMaximized: boolean
  readonly windowControlsDisabled?: boolean
}

/**
 * Desktop platform chrome.
 *
 * 窗口拖拽与双击最大化由 Tauri 原生处理：标注 data-tauri-drag-region 的元素
 * 交给 webview（capabilities 已声明 core:window:allow-start-dragging），前端
 * 不监听 mousedown、不维护交互元素黑名单、也没有会失败的原生调用需要降级。
 *
 * 标注挂在容器上是安全的：Tauri v2 规定该属性只对被直接标注的元素生效，不向
 * 子元素继承，正是为了让按钮、输入框照常工作。此前源码注释断言"挂在含按钮的
 * 容器上会让按钮静默失灵"，与官方文档相悖，代价是最左侧一段标题栏长期不可拖。
 *
 * 拖拽区属于标题栏本身。之前全仓库唯一的标注寄生在标签条里，设置界面不渲染
 * 标签条，整窗随之不可拖——归属错了，不是漏标。这里是两段：左侧开合区、中间
 * 填充区；右侧全被窗口控制键占满，没有可标注的空白。
 *
 * 这里不画 chrome 与内容之间的横线。那条线是外壳栅格 chrome 行的边界，由
 * WorkspaceShell 的 header 统一持有；标题栏内部再画一截，就会随内部结构
 * 变化而断续。
 *
 * 这里没有容器级 ARIA 角色。原先整条标注 role="toolbar"，而 toolbar 的契约是
 * roving tabindex，本组件从未实现；它的子元素里还有一整条 role="tablist"，也
 * 不是 toolbar 的合法子元素。声明一个不兑现的角色比不声明更糟。
 */
export function DesktopTitleBar({
  children,
  onMinimize,
  onMaximize,
  onClose,
  onSidebarToggle,
  isSidebarOpen,
  isMaximized,
  windowControlsDisabled = false,
}: DesktopTitleBarProps) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 items-stretch bg-chrome">
      {/*
       * 左上角一个区域，不是两个。
       *
       * 宽度 = max(侧边栏列宽, 开合按钮容器宽)。展开时列宽胜出，右边界与
       * "侧边栏／主界面"分隔线是同一个 x 坐标，竖线因此天然对齐而不是靠手调；
       * 收起时列宽归零、由按钮容器托底，开合按钮永远有落脚点。
       *
       * 按钮留在正常流里。绝对定位同样能固定位置，但列宽归零后它会溢出到右侧
       * 标签条的地盘，被标签条的层叠上下文和不透明底色盖住——按钮还在、只是
       * 点不到，这是上一版的故障。
       *
       * 宽度直接读 motion 正在驱动的 --workspace-sidebar-column-width，收缩过程
       * 跟着面板同一条时间轴、到兜底宽度自然刹停，不需要另写一套动画。
       */}
      <div
        className="relative flex shrink-0 items-center"
        data-tauri-drag-region
        style={{
          paddingLeft:
            'calc(var(--workspace-sidebar-nav-icon-center) - var(--ui-control-height-sm) / 2)',
          width:
            'max(var(--workspace-sidebar-column-width, 0px), var(--workspace-sidebar-toggle-zone))',
        }}
      >
        <Button
          aria-label={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          className="size-[var(--ui-control-height-sm)] shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          onClick={onSidebarToggle}
          size="icon"
          type="button"
          variant="ghost"
        >
          {isSidebarOpen ? (
            <PanelLeftClose aria-hidden="true" className="size-4" />
          ) : (
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          )}
        </Button>

        {/*
         * 竖线是一个独立元素而不是容器的 border-right：border 宽度在 1px 和 0
         * 之间只能硬切，而这条线该跟着面板一起淡出。它贴在容器右边界上，所以
         * 位置仍然由上面那个 max() 唯一决定，没有第二份坐标。
         */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 border-r border-divider"
          style={{
            opacity: isSidebarOpen ? 1 : 0,
            transition: 'opacity var(--workspace-layout-duration, 0.22s) ease',
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 items-stretch" data-tauri-drag-region>
        {children}
      </div>

      <WindowControls
        disabled={windowControlsDisabled}
        isMaximized={isMaximized}
        onClose={onClose}
        onMaximize={onMaximize}
        onMinimize={onMinimize}
      />
    </div>
  )
}
