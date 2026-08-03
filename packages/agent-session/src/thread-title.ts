import type { ThreadRecord } from '@poietica/acp'

/*
 * 一条对话叫什么，只有这一份规则。
 *
 * 它此前是 ThreadsStore 的一个私有方法，可它一个实例字段都不读 —— 收 record，
 * 收占位，交出名字。锁在 35KB 的 store 里，唯一的效果是它测不了、也复用不了。
 */

/** Shown for a conversation nothing has named yet: the words of the entry. */
export const FALLBACK_TITLE = '新建对话'

/** How much of a stand in title a tab can carry. */
const TITLE_LIMIT = 24

/** Cuts a stand in title down to something a tab can show. */
export const shorten = (text: string): string => {
  const tidy = text.trim().replace(/\s+/g, ' ')

  if (tidy.length === 0) {
    return FALLBACK_TITLE
  }

  if (tidy.length <= TITLE_LIMIT) {
    return tidy
  }

  return `${tidy.slice(0, TITLE_LIMIT)}…`
}

/**
 * 名字的排名：用户手打的 > 第一句话 > 入口占位。
 *
 * 占位存在的理由只有一个：平台还没记下这条对话，屏幕上总得写点什么。它一旦
 * 排到权威名字之上，就从"还没有名字时的替身"变成"永远压着名字的一层"。
 *
 * titleSource === 'message' 时那一格装的就是第一句话，逐字 —— 库那侧
 * record_prompt 的 CASE 只在 fallback 时写标题。
 */
export function nameOf(found: ThreadRecord | undefined, provisional: string | undefined): string {
  if (found?.titleSource === 'manual') {
    return found.title
  }

  if (found?.titleSource === 'message') {
    return shorten(found.title)
  }

  return provisional ?? FALLBACK_TITLE
}
