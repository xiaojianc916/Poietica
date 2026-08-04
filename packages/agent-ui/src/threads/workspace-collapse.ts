import { useSyncExternalStore } from 'react'

/*
 * 哪些工作区是收起来的。
 *
 * 一份状态，不是每个组头一个 useState：收起来这件事要跨重挂载、跨窗口、跨重启
 * 存活 —— 组件本地状态三样都做不到。订阅走 useSyncExternalStore，这是 React 对
 * 外部数据源的官方接线方式，与 threads/clock.ts 同一个形状，不是第二套办法。
 *
 * 落盘用 localStorage：它是同步的，所以首帧读得到，不会先展开再收起闪一下。
 * storage 事件让同一个应用的另一个窗口跟着变 —— 那是浏览器免费给的一致性，
 * 自己发消息去同步反而会漏。
 */

const KEY = 'poietica.threads.collapsedWorkspaces'

const EMPTY: ReadonlySet<string> = new Set()

const listeners = new Set<() => void>()

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

let collapsed = stored()

function announce(): void {
  for (const listen of listeners) {
    listen()
  }
}

function adopt(next: ReadonlySet<string>): void {
  collapsed = next

  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...next]))
  } catch {
    /* 写不进去只是下次启动记不住，不值得让这一次点击失败。 */
  }

  announce()
}

/* 另一个窗口改了同一份偏好。值由那一侧写好了，这里只重读。 */
function subscribe(listen: () => void): () => void {
  listeners.add(listen)

  if (listeners.size === 1) {
    globalThis.addEventListener?.('storage', reread)
  }

  return () => {
    listeners.delete(listen)

    if (listeners.size === 0) {
      globalThis.removeEventListener?.('storage', reread)
    }
  }
}

function reread(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEY) {
    return
  }

  collapsed = stored()
  announce()
}

const readCollapsed = () => collapsed

const readServer = () => EMPTY

/** 收起了哪些工作区。返回的集合在值没变时恒是同一个引用。 */
export function useCollapsedWorkspaces(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, readCollapsed, readServer)
}

/** 收起或展开一个工作区。 */
export function toggleWorkspace(id: string): void {
  const next = new Set(collapsed)

  if (!next.delete(id)) {
    next.add(id)
  }

  adopt(next)
}
