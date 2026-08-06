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

/**
 * 写回整本目录。写成功没有值可给。
 *
 * await 放在 throughIpc 的回调里面，不是外面：原生这条命令在 Rust 那侧是
 * Result<(), IpcError>，而 specta 把 () 编码成 null —— 那是传输层的编码，
 * 不是这一层的语义，让它漏出去等于要求每个调用方都知道「保存成功会拿到一个
 * null」。同包 asset.ts 的 removeAsset / closeAssetSession 就是这么写的，
 * 这里照抄那个形状，不为同一件事发明第二种写法。
 */
export function saveAutomations(catalog: AutomationCatalog): Promise<void> {
  return throughIpc(async () => {
    await commands.automationsSave(catalog)
  })
}
