import type { Automation } from '@poietica/ipc'

import { describeMoment, describeTrigger, latestRun } from '../automation'
import type { AutomationStore } from '../automation-store'

/**
 * 「我的自动化」这张表。
 *
 * 自己不持有任何状态：它是快照的一次投影，加三个直接打到 store 上的动作。
 * 收整个 store 而不是三个回调，因为它确实要用到 runNow / setEnabled / remove
 * 三个命令 —— 再拆成三个 prop 只是把同一件事写三遍。
 */

export interface AutomationListProps {
  readonly automations: readonly Automation[]
  readonly loaded: boolean
  readonly store: AutomationStore
}

export function AutomationList({ automations, loaded, store }: AutomationListProps) {
  /*
   * loaded 一起判：首帧和「读完了但确实一条都没有」不是同一件事，
   * 少了它空态会在启动瞬间闪一下。
   */
  if (loaded && automations.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        还没有自动化。从下面的模板开始，或者新建一个。
      </p>
    )
  }

  return (
    <table className="w-full table-fixed border-collapse text-left text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-divider">
          <th className="w-[38%] py-2 font-medium">自动化</th>
          <th className="w-[14%] py-2 font-medium">状态</th>
          <th className="w-[16%] py-2 font-medium">触发</th>
          <th className="w-[16%] py-2 font-medium">最近运行</th>
          <th className="w-[16%] py-2 text-right font-medium">操作</th>
        </tr>
      </thead>

      <tbody>
        {automations.map((automation) => (
          <Row automation={automation} key={automation.id} store={store} />
        ))}
      </tbody>
    </table>
  )
}

function Row({
  automation,
  store,
}: {
  readonly automation: Automation
  readonly store: AutomationStore
}) {
  const run = latestRun(automation)

  return (
    <tr className="border-b border-divider/60">
      <td className="py-2.5 pr-4">
        <p className="truncate font-medium">{automation.title}</p>
        <p className="truncate text-muted-foreground">{automation.prompt}</p>
      </td>

      <td className="py-2.5 text-muted-foreground">{automation.enabled ? '启用' : '停用'}</td>

      <td className="py-2.5 text-muted-foreground">{describeTrigger(automation.trigger)}</td>

      <td className="py-2.5 text-muted-foreground">
        {run === null
          ? '未运行'
          : `${run.outcome === 'succeeded' ? '成功' : '失败'} · ${describeMoment(run.startedAt)}`}
      </td>

      <td className="py-2.5 text-right">
        <RowAction
          label="运行"
          onClick={() => {
            store.runNow(automation.id)
          }}
        />
        <RowAction
          label={automation.enabled ? '停用' : '启用'}
          onClick={() => {
            store.setEnabled(automation.id, !automation.enabled)
          }}
        />
        <RowAction
          label="删除"
          onClick={() => {
            store.remove(automation.id)
          }}
        />
      </td>
    </tr>
  )
}

function RowAction({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      className="ml-2 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}
