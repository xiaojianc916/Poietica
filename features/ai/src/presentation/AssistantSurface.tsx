import { TooltipProvider } from '@hybrid-canvas/design-system'

import { useAssistantSession } from '../application/useAssistantSession'
import type { AgentRegistryPort } from '../contracts/agent-contract'
import type { AssistantTransportPort } from '../contracts/transport-contract'
import { DEFAULT_AGENT } from '../domain/agent-registry'
import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import { AssistantMark } from './primitives/AssistantMark'

export interface AssistantSurfaceProps {
  readonly transport: AssistantTransportPort
  readonly registry: AgentRegistryPort
  readonly title?: string
}

export function AssistantSurface({
  transport,
  registry,
  title = '接下来我们做点什么？',
}: AssistantSurfaceProps) {
  const { composer, commands } = useAssistantSession({ registry, transport })
  const agent = registry.get(composer.activeAgentId) ?? DEFAULT_AGENT

  return (
    <TooltipProvider delayDuration={450}>
      <section
        aria-label="AI"
        className="relative h-full min-h-0 overflow-y-auto bg-background px-8 py-16"
      >
        <div className="mx-auto w-full max-w-[640px]">
          <div className="mb-7 flex items-center justify-center gap-2.5">
            <AssistantMark className="size-[22px] text-foreground" />
            <h1 className="text-[22px] font-medium tracking-[-0.02em]">{title}</h1>
          </div>

          <AssistantComposer agent={agent} commands={commands} model={composer} />

          <AssistantQuickActions onPick={commands.setDraft} />
        </div>
      </section>
    </TooltipProvider>
  )
}
