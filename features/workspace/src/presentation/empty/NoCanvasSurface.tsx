import { FilePlus, Folder } from '@mynaui/icons-react'
import { Button } from '@poietica/foundations-design-system'
import { formatKeybinding } from '../commands/keybinding'

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
 *
 * 快捷键写作与平台无关的逻辑形式，交给 formatKeybinding 渲染：macOS 得到 ⌘N，
 * 其余平台得到 Ctrl+N，与命令面板里同一条命令的显示保持一致。
 */
export function NoCanvasSurface({ onCreateDocument, onOpenDocument }: NoCanvasSurfaceProps) {
  const actions = [
    { icon: FilePlus, label: '创建新画布', shortcut: 'Mod+N', onClick: onCreateDocument },
    { icon: Folder, label: '打开画布文件', shortcut: 'Mod+O', onClick: onOpenDocument },
  ]

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

        <div className="mx-auto mt-6 flex w-fit flex-col items-center gap-1">
          {actions.map(({ icon: Icon, label, shortcut, onClick }) => (
            <Button
              className="h-9 gap-2 px-3 text-primary hover:bg-primary/10 hover:text-primary"
              key={label}
              onClick={onClick}
              type="button"
              variant="ghost"
            >
              <Icon aria-hidden="true" className="size-4" />
              <span>{label}</span>
              <kbd className="ml-1 rounded border border-primary/15 bg-primary/5 px-1.5 py-0.5 text-micro font-normal text-primary/75">
                {formatKeybinding(shortcut)}
              </kbd>
            </Button>
          ))}
        </div>
      </div>
    </section>
  )
}
