/**
 * 本机账本里的图，挂回它当初那句话上。
 *
 * 与协议无关：日志里没有图片帧 —— 图不来自 agent，它是这台机器上的文件，由
 * 原生侧另记一本账（见迁移 0011）。两份东西在这里合流，一份由 agent 交还，
 * 一份只存在于本机；它们没有共同的 id，所以对齐只能靠数数，或者靠本进程刚
 * 发出去的那一条自己的 id。
 *
 * 它此前住在 timeline-reducer 里，而那个文件开篇讲的是帧、序号与可重放 ——
 * 这里一帧都不碰，一个序号都不占，也不参与重放。
 */

import type { MessageImage, TimelineState, UserMessageItem } from './timeline-contract'
import { appendLocalError } from './timeline-reducer'

/** 账本里的一张图，以及它属于哪一句话。 */
export interface ReplayedAttachment {
  readonly url: string
  readonly turn: number
  readonly ordinal: number
}

/**
 * 把账本里的图挂回它当初那句话上。
 *
 * 两份东西在这里合流：一段由 agent 交还的经过，和一张只存在于本机的账本。
 * 它们没有共同的 id —— 这个程序不存对话内容，历史里的每一个 id 都是 agent
 * 发的，本地账本不可能引用它们。能由两侧各自数出同一个答案的只有序号。
 *
 * 所以对齐靠数数，而且是**倒着数**：账本的计数 N 盖住的是最后 N 条用户消息
 * （见迁移 0011）。正着数在任何一条早于 0011 的对话上都是错的 —— 那些话发生
 * 在计数存在之前，第 0 轮并不是第一条消息。
 *
 * 数的是「消息」，不是「帧」。协议按 content block 发 chunk，一句「文字加一
 * 张图」是两帧；把帧当消息数，这两个数就永远不等，而不等的后果是整批不认领。
 * 并帧的规矩只有一处（appendSaid），这条对齐能不能成立全靠它。
 *
 * 数的是「消息」，不是「帧」。协议按 content block 发 chunk，一句「文字加一张
 * 图」是两帧，一句纯图片在有些 agent 的回放里一帧都没有 —— 把帧当消息数，这
 * 两个数就没有一次会相等。并帧的规矩只有一处（appendSaid），这条对齐成不成立
 * 全靠它。
 *
 * 对不齐就整批不认领。历史比账本还短（换过 agent、只交回了一段），这时候硬挂
 * 就是把图挂到别人的话上；一张不显示，好过显示在错的地方 —— 后者人看不出来。
 *
 * 但不认领要说出来。此前这两条路径是光秃秃的 return state：图没了，屏幕上没有
 * 任何痕迹，连排查的入口都没有 —— 这个文件自己的原则是「空本身不是问题，不作声
 * 才是」，那条原则此前只写给了历史，没写给附件。
 *
 * 顺序不在这里定：账本按 (turn, ordinal) 排好了才交过来（见 attachments_of
 * 的 ORDER BY），这里再排一遍就是第二份排序规则。
 */
export function attachImages(
  state: TimelineState,
  attachments: readonly ReplayedAttachment[],
  prompts: number,
): TimelineState {
  if (attachments.length === 0) {
    return state
  }

  const said: number[] = []

  for (const [position, item] of state.items.entries()) {
    if (item.type === 'user_message') {
      said.push(position)
    }
  }

  /* 账本盖不住的那一段前史，跳过它。负数意味着这段经过比账本还短。 */
  const offset = said.length - prompts

  if (offset < 0) {
    return unclaimed(state, attachments, prompts, said.length)
  }

  const carried = new Map<number, MessageImage[]>()

  for (const attachment of attachments) {
    const position = said[offset + attachment.turn]

    /* 一格对不上，整批都不能信：说明这两侧数出来的不是同一件事。 */
    if (position === undefined) {
      return unclaimed(state, attachments, prompts, said.length)
    }

    const held = carried.get(position)

    if (held === undefined) {
      carried.set(position, [{ url: attachment.url }])

      continue
    }

    held.push({ url: attachment.url })
  }

  const items = state.items.slice()

  for (const [position, images] of carried) {
    const item = items[position]

    if (item?.type !== 'user_message') {
      return state
    }

    const grown: UserMessageItem = { ...item, images }

    items[position] = grown
  }

  return { ...state, items }
}

/**
 * 这一句的图片地址到了，挂回去。
 *
 * 与 attachImages 是同一件事的两种处境，不是两套规则：那一条要在两侧各自数出
 * 来的序号之间对齐，因为账本与 agent 交还的历史没有共同的 id；而这一条的那句
 * 话就是这个进程刚刚追加的，id 在手上，所以按 id 定位——能点名的时候数数就是
 * 多出来的一层猜测。
 *
 * 找不到那一条就什么都不做：这条对话可能已经被删掉，也可能这句话被后来的帧
 * 合并走了。悄悄不挂，好过把图挂到别人的话上 —— 后者人看不出来。
 */
export function attachImagesTo(
  state: TimelineState,
  id: string,
  images: readonly MessageImage[],
): TimelineState {
  if (images.length === 0) {
    return state
  }

  const position = state.items.findIndex((item) => item.id === id)
  const item = state.items[position]

  if (item?.type !== 'user_message') {
    return state
  }

  const items = state.items.slice()

  items[position] = { ...item, images }

  return { ...state, items }
}

/**
 * 这批图没能挂回原处，说一声。
 *
 * 走的是本地事故那条既有通道（appendLocalError），与「历史取不回来」同一条
 * 横线：两者都发生在任何一帧之外，日志里都没有对应的帧。endsTurn 为假 ——
 * 这不是某一轮失败了。
 *
 * 两个数字写进这句话里，因为它们正是判断出在哪一侧的全部依据：账本多，说明
 * agent 没把那几句话回放出来；屏幕多，说明一句话被拆成了几条。
 *
 * 时间取末尾那一条的，这一层不持有时钟（见文件头）。
 */
function unclaimed(
  state: TimelineState,
  attachments: readonly ReplayedAttachment[],
  prompts: number,
  said: number,
): TimelineState {
  return appendLocalError(state, {
    message: `这条对话有 ${String(attachments.length)} 张图没能挂回原处：账本记着 ${String(prompts)} 句话，重放出来 ${String(said)} 句。`,
    at: state.items.at(-1)?.at ?? 0,
    endsTurn: false,
  })
}
