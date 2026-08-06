import type { WorkspaceSurfaceRenderers } from '../surface'
import { describeWorkspaceSurface } from '../surface-registry'
import type { WorkspaceSurfaceId } from '../workbench'
import { surfaceIcon } from './surface-icons'

export interface WorkspaceSurfaceProps {
  readonly surfaceId: WorkspaceSurfaceId

  /**
   * 由 apps 组合根注入的表面渲染器。
   *
   * workspace 不得依赖任何 feature 包；具体表面（如 AI）通过此扩展点接入。
   * 组合根恒定注入，因此这里不是可选项。
   */
  readonly renderers: WorkspaceSurfaceRenderers
}

export function WorkspaceSurface({ surfaceId, renderers }: WorkspaceSurfaceProps) {
  const render = renderers[surfaceId]

  if (render) {
    return <>{render()}</>
  }

  /*
   * 描述符只说得出 iconId：领域层不持有 React 组件，组件由这一层查表得到。
   * 这是同一条规则的第四个落点（另三处：SidebarNav、WorkbenchTab、SidebarFooter）。
   */
  const { title, description } = describeWorkspaceSurface(surfaceId)
  const Icon = surfaceIcon(surfaceId)

  return (
    <section
      aria-labelledby={`workspace-surface-title-${surfaceId}`}
      className="relative grid h-full place-items-center overflow-hidden bg-ground px-8"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(var(--color-divider)_0.7px,transparent_0.7px)] bg-size-[18px_18px] opacity-35"
      />

      <div className="relative max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl border border-divider bg-background shadow-sm">
          <Icon aria-hidden="true" className="text-muted-foreground" />
        </div>

        <h1
          className="mt-4 text-base font-semibold tracking-tight"
          id={`workspace-surface-title-${surfaceId}`}
        >
          {title}
        </h1>

        <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}
