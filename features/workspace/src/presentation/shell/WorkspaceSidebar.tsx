import { FileText, Grid, Plus, Search } from '@mynaui/icons-react'
import { Button, cn, ScrollArea } from '@poietica/foundations-design-system'
import { useState } from 'react'

import type { CanvasPageViewModel } from '../../contracts/shell-contract'
import type { WorkspacePanelRenderers } from '../../contracts/surface-contract'
import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import { describeWorkspaceSurface } from './surface-registry'

export interface WorkspaceSidebarProps {
  readonly activeNavigationItem: WorkspaceSurfaceId
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
  const [query, setQuery] = useState('')

  if (activeNavigationItem !== 'pages') {
    const renderPanel = panelRenderers?.[activeNavigationItem]

    return (
      <section className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar">
        {renderPanel ? renderPanel() : <SurfacePlaceholder surfaceId={activeNavigationItem} />}
      </section>
    )
  }

  const keyword = query.trim().toLocaleLowerCase()

  const visiblePages =
    keyword === ''
      ? pages
      : pages.filter((page) => page.title.toLocaleLowerCase().includes(keyword))

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2.5">
          <div className="mb-4 flex h-[var(--ui-control-height-sm)] items-center gap-2 rounded-md border border-divider bg-background px-2 text-muted-foreground focus-within:border-primary">
            <Search aria-hidden="true" className="size-3.5 shrink-0" />

            <input
              aria-label="筛选画布"
              className="min-w-0 flex-1 bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              placeholder="筛选画布"
              type="search"
              value={query}
            />
          </div>

          <div className="mb-1.5 flex items-center justify-between px-2 py-1">
            <span className="text-caption font-semibold uppercase tracking-widest text-muted-foreground">
              画布
            </span>

            <span className="grid size-4 place-items-center rounded-full bg-muted text-micro text-muted-foreground">
              {visiblePages.length}
            </span>
          </div>

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
          ) : visiblePages.length === 0 ? (
            <p className="px-3 py-8 text-center text-caption text-muted-foreground">
              没有匹配的画布
            </p>
          ) : (
            <div className="space-y-0.5">
              {visiblePages.map((page) => (
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
                  {page.isActive ? (
                    <Grid aria-hidden="true" className="size-3.5 shrink-0" />
                  ) : (
                    <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                  )}

                  <span className="truncate font-medium">{page.title}</span>

                  {page.isActive ? (
                    <span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-primary" />
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
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
