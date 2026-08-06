import { throughIpc } from './error'
import { commands } from './generated/ipc-bindings'

/*
 * 自动化的读写。
 *
 * DTO 一个字都不在这里声明：原生侧的 commands/automations.rs 是权威，形状经由
 * 生成绑定过来。同包 error.ts 已经为「手抄 DTO」记过一次账 —— 手抄出来的类型
 * 编译器一个字也不会说。
 *
 * 读不到不是错误：原生侧读不动会退回空目录，所以这里没有 null 分支。
 */

export type {
  Automation,
  AutomationCatalog,
  AutomationRun,
  AutomationRunOutcome,
  AutomationTrigger,
} from './generated/ipc-bindings'

import type { AutomationCatalog } from './generated/ipc-bindings'

export function loadAutomations(): Promise<AutomationCatalog> {
  return throughIpc(() => commands.automationsLoad())
}

export function saveAutomations(catalog: AutomationCatalog): Promise<void> {
  return throughIpc(() => commands.automationsSave(catalog))
}
