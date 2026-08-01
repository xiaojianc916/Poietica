import { Button, InlineSpinner } from '@poietica/foundations-design-system'
import type { AgentConfigStore } from '../ports/agent-config-store'
import { useAgentInstall } from './useAgentInstall'

export interface AgentInstallActionProps {
  readonly store: AgentConfigStore
  readonly agentId: string
}

/**
 * ACP Agent 这一行上的「安装 / 更新」。
 *
 * 没有可做的事时它一个像素都不画：一个装好且是最新的 agent，这一行不该有噪音。
 * 尺寸与形状取自设计系统的行内动作按钮（soft / xs），与这一页其余按钮同一颗。
 */
export function AgentInstallAction({ store, agentId }: AgentInstallActionProps) {
  const install = useAgentInstall(store, agentId)

  if (install.action === 'none' && install.error === null) {
    return null
  }

  return (
    <>
      {install.error === null ? null : <span className="models-row__meta">{install.error}</span>}
      {install.busy ? <InlineSpinner /> : null}
      {install.action === 'none' ? null : (
        <Button
          disabled={install.busy}
          onClick={install.run}
          size="xs"
          type="button"
          variant="soft"
        >
          {install.label}
        </Button>
      )}
    </>
  )
}
