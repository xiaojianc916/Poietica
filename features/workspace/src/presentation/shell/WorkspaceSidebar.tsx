import { FileText, Grid, Plus } from '@mynaui/icons-react'
import { Button, cn, ScrollArea } from '@poietica/foundations-design-system'

import type { CanvasPageViewModel } from '../../contracts/shell-contract'
import type { WorkspacePanelRenderers } from '../../contracts/surface-contract'
import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import { SidebarFooter } from './SidebarFooter'
import { SidebarNav } from './SidebarNav'
import { describeWorkspaceSurface } from './surface-registry'

export interface WorkspaceSidebarProps {
  readonly activeNavigationItem: WorkspaceSurfaceId
  readonly pages: readonly CanvasPageViewModel[]
  readonly onActivatePage: (pageId: string) => void
  readonly onCreatePage: () => void
  readonly onSurfaceActivate: (surfaceId: WorkspaceSurfaceId) => void
  readonly onCreateConversation: () => void
  readonly onSettingsOpen: () => void
  readonly onDeveloperToolsOpen: () => void
  readonly panelRenderers?: WorkspacePanelRenderers
}

/**
 * 侧边栏。
 *
 * 三段式，自上而下：导航 / 面板体 / 底部行。图标 rail 被移除后，导航成为
 * 本列的一部分，所以整个左侧只有一列、只有一个可见性状态。
 *
 * 面板体本身不属于这里：除 'pages' 之外的 surface 一律由应用组合根通过
 * panelRenderers 注入，features/* 之间不互相依赖这条规则不变。
 */
export function WorkspaceSidebar({
  activeNavigationItem,
  pages,
  onActivatePage,
  onCreatePage,
  onSurfaceActivate,
  onCreateConversation,
  onSettingsOpen,
  onDeveloperToolsOpen,
  panelRenderers,
}: WorkspaceSidebarProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar">
      <SidebarNav
        activeSurfaceId={activeNavigationItem}
        onCreateConversation={onCreateConversation}
        onSurfaceActivate={onSurfaceActivate}
      />

      <div className="min-h-0 min-w-0 flex-1">
        <SidebarBody
          activeNavigationItem={activeNavigationItem}
          onActivatePage={onActivatePage}
          onCreatePage={onCreatePage}
          pages={pages}
          {...(panelRenderers === undefined ? {} : { panelRenderers })}
        />
      </div>

      <SidebarFooter onDeveloperToolsOpen={onDeveloperToolsOpen} onSettingsOpen={onSettingsOpen} />
    </section>
  )
}

interface SidebarBodyProps {
  readonly activeNavigationItem: WorkspaceSurfaceId
  readonly pages: readonly CanvasPageViewModel[]
  readonly onActivatePage: (pageId: string) => void
  readonly onCreatePage: () => void
  readonly panelRenderers?: WorkspacePanelRenderers
}

function SidebarBody({
  activeNavigationItem,
  pages,
  onActivatePage,
  onCreatePage,
  panelRenderers,
}: SidebarBodyProps) {
  if (activeNavigationItem !== 'pages') {
    const renderPanel = panelRenderers?.[activeNavigationItem]

    return renderPanel ? (
      <>{renderPanel()}</>
    ) : (
      <SurfacePlaceholder surfaceId={activeNavigationItem} />
    )
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="p-2">
        {pages.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <div className="mx-auto grid size-9 place-items-center rounded-lg border border-divider bg-background">
              <Grid aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>

            <p className="mt-3 text-xs font-medium">还没有页面</p>

            <p className="mt-1 text-caption leading-4 text-muted-foreground">
              创建页面后即可开始绘制
            </p>

            <Button
              className="mt-3"
              onClick={onCreatePage}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              新建页面
            </Button>
          </div>
        ) : (
          <div className="space-y-px">
            {pages.map((page) => (
              <button
                aria-current={page.isActive ? 'page' : undefined}
                className={cn(
                  'group flex h-[var(--ui-control-height-md)] w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                  page.isActive && 'bg-sidebar-accent text-foreground',
                )}
                key={page.id}
                onClick={() => onActivatePage(page.id)}
                type="button"
              >
                {page.isActive ? (
                  <Grid aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                )}

                <span className="truncate font-medium">{page.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function SurfacePlaceholder({ surfaceId }: { readonly surfaceId: WorkspaceSurfaceId }) {
  const { title, description, icon: Icon } = describeWorkspaceSurface(surfaceId)

  return (
    <section className="grid h-full min-h-0 place-items-center bg-sidebar px-6 text-center">
      <div className="max-w-44">
        <div className="mx-auto grid size-10 place-items-center rounded-xl border border-divider bg-background shadow-sm">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        </div>

        <p className="mt-3 text-xs font-medium">{title}</p>

        <p className="mt-1 text-caption leading-5 text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}
