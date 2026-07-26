import { Button } from '@poietica/foundations-design-system'
import { FilePlus, Folder } from '@mynaui/icons-react'

export interface NoCanvasSurfaceProps {
  readonly onCreateDocument: () => void
  readonly onOpenDocument: () => void
}

/**
 * Canvas start surface.
 *
 * The callbacks are intentionally owned by the workspace container:
 * - onCreateDocument creates a real canvas session.
 * - onOpenDocument opens the platform file workflow.
 *
 * This component only owns the empty-state presentation and never creates a
 * second document or persistence path.
 */
export function NoCanvasSurface({ onCreateDocument, onOpenDocument }: NoCanvasSurfaceProps) {
  return (
    <section
      aria-labelledby="no-canvas-title"
      className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-canvas px-6"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-45 bg-[radial-gradient(var(--color-divider)_0.7px,transparent_0.7px)] bg-size-[18px_18px]"
      />

      <div className="relative w-full max-w-sm text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgb(255_255_255_/_0.45)]">
          <FilePlus aria-hidden="true" className="size-5" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight" id="no-canvas-title">
          开始创作
        </h1>

        <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
          创建一张无限画布，或打开已有的画布文件。
        </p>

        <div aria-label="画布操作" className="mx-auto mt-6 flex w-fit flex-col items-center gap-1">
          <Button
            className="h-9 gap-2 px-3 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={onCreateDocument}
            type="button"
            variant="ghost"
          >
            <FilePlus aria-hidden="true" className="size-4" />
            <span>创建新画布</span>
            <kbd className="ml-1 rounded border border-primary/15 bg-primary/5 px-1.5 py-0.5 text-micro font-normal text-primary/75">
              Ctrl + N
            </kbd>
          </Button>

          <Button
            className="h-9 gap-2 px-3 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={onOpenDocument}
            type="button"
            variant="ghost"
          >
            <Folder aria-hidden="true" className="size-4" />
            <span>打开画布文件</span>
            <kbd className="ml-1 rounded border border-primary/15 bg-primary/5 px-1.5 py-0.5 text-micro font-normal text-primary/75">
              Ctrl + O
            </kbd>
          </Button>
        </div>
      </div>
    </section>
  )
}
