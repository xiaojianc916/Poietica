import {
  Box,
  ChartNetwork,
  FileText,
  FolderTwo,
  Grid,
  Image,
  LayersThree,
  Plus,
  Search,
} from '@mynaui/icons-react'
import { Button, cn, ScrollArea } from '@poietica/foundations-design-system'
import type { CanvasPageViewModel } from '../../contracts/shell-contract'
import type { WorkspacePanelRenderers } from '../../contracts/surface-contract'
import type { CanvasNavigationItemId } from './ActivityRail'
import { AiSurfaceIcon } from './icons/AiSurfaceIcon'

export interface WorkspaceSidebarProps {
  readonly activeNavigationItem: CanvasNavigationItemId
  readonly pages: readonly CanvasPageViewModel[]
  readonly onActivatePage: (pageId: string) => void
  readonly onCreatePage: () => void
  readonly panelRenderers?: WorkspacePanelRenderers
}

export function WorkspaceSidebar({
  activeNavigationItem,
  pages,
  onActivatePage,
  onCreatePage,
  panelRenderers,
}: WorkspaceSidebarProps) {
  if (activeNavigationItem !== 'pages') {
    const renderPanel = panelRenderers?.[activeNavigationItem]

    if (renderPanel) {
      return (
        <section className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar">
          {renderPanel()}
        </section>
      )
    }

    return <WorkspacePanel kind={activeNavigationItem} />
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2.5">
          <div className="mb-4 flex h-[var(--ui-control-height-sm)] items-center gap-2 rounded-md border border-divider bg-background px-2 text-muted-foreground shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)]">
            <Search className="size-3.5 shrink-0" />
            <span className="text-caption">筛选页面</span>
            <kbd className="ml-auto rounded border bg-muted/30 px-1 py-0.5 text-micro opacity-60">
              ⌘ F
            </kbd>
          </div>
          <div className="mb-1.5 flex items-center justify-between px-2 py-1">
            <span className="text-caption font-semibold uppercase tracking-widest text-muted-foreground">
              画布
            </span>
            <span className="grid size-4 place-items-center rounded-full bg-muted text-micro text-muted-foreground">
              {pages.length}
            </span>
          </div>
          {pages.length > 0 ? (
            <div className="space-y-0.5">
              {pages.map((page) => (
                <button
                  aria-current={page.isActive ? 'page' : undefined}
                  className={cn(
                    'group flex h-[var(--ui-control-height-md)] w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                    page.isActive &&
                      'bg-sidebar-accent text-foreground shadow-[inset_2px_0_0_var(--color-foreground)]',
                  )}
                  key={page.id}
                  onClick={() => onActivatePage(page.id)}
                  type="button"
                >
                  <PageIcon model={page} />
                  <span className="truncate font-medium">{page.title}</span>
                  {page.isActive ? (
                    <span className="ml-auto size-1.5 rounded-full bg-primary" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-10 text-center">
              <div className="mx-auto grid size-9 place-items-center rounded-lg border border-divider bg-background">
                <Grid className="size-4 text-muted-foreground" />
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
                <Plus className="size-3.5" />
                新建页面
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

const PANEL_DETAILS: Record<
  Exclude<CanvasNavigationItemId, 'pages'>,
  { title: string; description: string; icon: typeof FolderTwo }
> = {
  search: { title: '搜索', description: '搜索当前工作区中的页面、对象和文本内容。', icon: Search },
  layers: { title: '图层', description: '选择页面后，可在这里浏览和整理图层。', icon: LayersThree },
  relations: {
    title: '关系',
    description: '连接画布中的内容，建立可视化关系。',
    icon: ChartNetwork,
  },
  ai: {
    title: 'AI',
    description: '与 AI 协作生成、整理并驱动画布内容。',
    icon: AiSurfaceIcon,
  },
  assets: { title: '素材', description: '集中管理图片、附件和可复用素材。', icon: Image },
  extensions: { title: '插件', description: '探索能够增强画布工作流的扩展能力。', icon: Box },
  documents: {
    title: '恢复',
    description: '在这里恢复最近打开的画布与本地文件。',
    icon: FolderTwo,
  },
}

function WorkspacePanel({ kind }: { readonly kind: Exclude<CanvasNavigationItemId, 'pages'> }) {
  const { title, description, icon: Icon } = PANEL_DETAILS[kind]
  return (
    <section className="grid h-full min-h-0 place-items-center bg-sidebar px-6 text-center">
      <div className="max-w-44">
        <div className="mx-auto grid size-10 place-items-center rounded-xl border border-divider bg-background shadow-sm">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-3 text-xs font-medium">{title}</p>
        <p className="mt-1 text-caption leading-5 text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}

function PageIcon({ model }: { readonly model: CanvasPageViewModel }) {
  return model.isActive ? (
    <Grid className="size-3.5 shrink-0" />
  ) : (
    <FileText className="size-3.5 shrink-0" />
  )
}
