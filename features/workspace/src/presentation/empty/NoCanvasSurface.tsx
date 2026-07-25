import { Button } from '@poietica/foundations-design-system'
import { FilePlus, Folder } from '@mynaui/icons-react'
export interface NoCanvasSurfaceProps {
  readonly onCreateDocument: () => void
  readonly onOpenDocument: () => void
}

export function NoCanvasSurface({ onCreateDocument, onOpenDocument }: NoCanvasSurfaceProps) {
  return (
    <div className="relative grid h-full place-items-center overflow-hidden bg-canvas px-8">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-45 bg-[radial-gradient(var(--color-divider)_0.7px,transparent_0.7px)] bg-size-[18px_18px]"
      />
      <section className="relative text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-lg border border-divider bg-background shadow-sm">
          <FilePlus className="size-4 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">开始创作</h1>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          新建一张无限画布，或打开已有的 .draw 文件。
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={onCreateDocument} size="sm" type="button">
            <FilePlus className="size-3.5" />
            新建画布
          </Button>
          <Button onClick={onOpenDocument} size="sm" type="button" variant="outline">
            <Folder className="size-3.5" />
            打开文件
          </Button>
        </div>
      </section>
    </div>
  )
}
