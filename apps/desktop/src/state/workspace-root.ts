import { createExternalStore } from '@poietica/agent-ui'
import { normalizeWorkspaceRoot } from '@poietica/core'
import { useSyncExternalStore } from 'react'

/*
 * 当前的工作目录 —— 整个进程唯一的答案。
 *
 * 它是 agent 的作用域：会话在这个目录里开，对话按这个目录分组，工作台状态按
 * 这个目录分域。此前这个概念在界面上只有一格空的「仓库」占位页，运行期一个
 * 答案都没有，于是 IPC 一路送 cwd: null。
 *
 * 落盘用 localStorage，与 workspace-collapse 同一套理由：@poietica/settings
 * 那条管线是异步的，第一帧读不到值 —— 而这一格决定第一次 open 打在哪个目录里，
 * 它必须在第一帧就有答案。storage 事件让同一个应用的另一个窗口跟着变。
 *
 * 缺席是有含义的，不是错误状态：还没有选过目录。那时候分组落在
 * DEFAULT_WORKSPACE_ID 上、界面不画组头（见 agent-session 的 workspaceNameOf），
 * 与今天的行为逐字相同。
 */

const KEY = 'poietica.workspace.activeRoot'

let active = stored()

function stored(): string | null {
  /* 读不出来就是没选过：一份坏掉的偏好不该让应用打不开。 */
  try {
    const raw = globalThis.localStorage?.getItem(KEY)

    return typeof raw === 'string' && raw.length > 0 ? normalizeWorkspaceRoot(raw) : null
  } catch {
    return null
  }
}

function reread(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEY) {
    return
  }

  active = stored()
  store.notify()
}

const store = createExternalStore<string | null>({
  read: () => active,
  activate: () => {
    globalThis.addEventListener?.('storage', reread)

    return () => {
      globalThis.removeEventListener?.('storage', reread)
    }
  },
})

const readServer = () => null

/**
 * 此刻的工作目录，还没有选过就是 null。
 *
 * 模块函数，引用终生不变，所以它可以直接当那个「一次求值」交给 IPC 的桥。
 */
export function activeWorkspaceRoot(): string | null {
  return active
}

/** 换一个工作目录。归一化只发生在这一处入口。 */
export function setActiveWorkspaceRoot(rootPath: string | null): void {
  const next = rootPath === null || rootPath.length === 0 ? null : normalizeWorkspaceRoot(rootPath)

  if (next === active) {
    return
  }

  active = next

  try {
    if (next === null) {
      globalThis.localStorage?.removeItem(KEY)
    } else {
      globalThis.localStorage?.setItem(KEY, next)
    }
  } catch {
    /* 写不进去只是下次启动记不住，不值得让这一次切换失败。 */
  }

  store.notify()
}

/** 订阅它。 */
export function useActiveWorkspaceRoot(): string | null {
  return useSyncExternalStore(store.subscribe, store.read, readServer)
}
