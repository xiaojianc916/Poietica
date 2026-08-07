import { createExternalStore } from '@poietica/agent-ui'
import { useSyncExternalStore } from 'react'

/*
 * 哪些工作区是收起来的。
 *
 * 住在应用层，不住在 agent-ui 里。它是一份用户偏好：有存储键、有跨窗口语义、
 * 一个进程里只该有一份 —— 这三件事都是宿主的事实，而 agent-ui 是一包展示组件。
 * 列表只收一个集合和一个动作：展示组件不绑死模块级可变状态，因此同一份列表在
 * 一个进程里画两次不会互相打断，也能在没有 localStorage 的环境里渲染。
 *
 * 落盘用 localStorage，不走 @poietica/settings：那条管线是异步的（AppShell 在
 * effect 里 await runtime.settings.load()），第一帧读不到值，于是每次开窗所有
 * 收起的组都会先展开一帧再收起。localStorage 是同步的，首帧就有答案 —— 这不是
 * 遗漏统一，这是这份状态的正确管线。storage 事件让同一个应用的另一个窗口跟着
 * 变，那是平台免费给的一致性，自己发消息去同步反而会漏。
 */

const KEY = 'poietica.threads.collapsedWorkspaces'

const EMPTY: ReadonlySet<string> = new Set()

let collapsed = stored()

function stored(): ReadonlySet<string> {
  /* 读不出来就是没收起过任何一个：一份坏掉的偏好不该让侧栏打不开。 */
  try {
    const raw = globalThis.localStorage?.getItem(KEY)

    if (raw === null || raw === undefined) {
      return EMPTY
    }

    const parsed: unknown = JSON.parse(raw)

    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : EMPTY
  } catch {
    return EMPTY
  }
}

/* 另一个窗口改了同一份偏好。值由那一侧写好了，这里只重读。 */
function reread(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEY) {
    return
  }

  collapsed = stored()
  store.notify()
}

const store = createExternalStore<ReadonlySet<string>>({
  read: () => collapsed,
  activate: () => {
    globalThis.addEventListener?.('storage', reread)

    return () => {
      globalThis.removeEventListener?.('storage', reread)
    }
  },
})

const readServer = () => EMPTY

/** 收起了哪些工作区。返回的集合在值没变时恒是同一个引用。 */
export function useCollapsedWorkspaces(): ReadonlySet<string> {
  return useSyncExternalStore(store.subscribe, store.read, readServer)
}

/** 收起或展开一个工作区。模块函数，引用稳定，可以直接当 prop 往下传。 */
export function toggleWorkspace(id: string): void {
  const next = new Set(collapsed)

  if (!next.delete(id)) {
    next.add(id)
  }

  collapsed = next

  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...next]))
  } catch {
    /* 写不进去只是下次启动记不住，不值得让这一次点击失败。 */
  }

  store.notify()
}
