import { useCallback } from 'react'

/** 距末端多近算作「仍在看最新一行」。与转录那一层同一个概念，尺度按盒子缩小。 */
const BOTTOM_SLACK = 8

/**
 * 让一个滚动盒跟住它自己的末端。
 *
 * 转录那一层早就有这套判据（AgentActivityFeed 的 isPinnedToEnd / followOnAppend），
 * 而思考过程这个盒子一直没有 —— 它的滚动位置在此之前没有任何所有者，唯一碰它的
 * use-scroll-fade 只读不写。同一个问题不该有两个答案，所以这里是同一套语义的最小
 * 形态，而不是另一套机制。
 *
 * 没有虚拟化，也就不需要虚拟器：内容长高由 ResizeObserver 报告（连不经过 React 的
 * 长高也覆盖，例如围栏里的 Shiki 解析完成、字体换页），跟随就是一次 scrollTop 赋值。
 * 不做平滑滚动：流式期间每一次长高都会重设目标，动画只会一直追不上自己。
 *
 * 是否跟随是一个事实，不是一个状态 —— 它不进 React，因为读一段思考不该在每个滚动
 * 帧重渲染整条转录。这一条与它取代的那个 hook 的理由完全相同。
 *
 * 赋值 scrollTop 会派发一次 scroll，于是 pinned 立刻被重新算成真：写入与判据共用
 * 同一个出口，不需要抑制标志，也就不会出现「程序滚动被误判成人在滚动」。
 *
 * Returned as a ref callback with a cleanup, which React 19 calls on unmount.
 */
export function useStickToBottom(): (node: HTMLElement | null) => void {
  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return
    }

    let pinned = true

    const sync = () => {
      pinned = node.scrollHeight - node.clientHeight - node.scrollTop <= BOTTOM_SLACK
    }

    const follow = () => {
      if (pinned) {
        node.scrollTop = node.scrollHeight
      }
    }

    const observer = new ResizeObserver(follow)
    observer.observe(node)

    const content = node.firstElementChild
    if (content !== null) {
      observer.observe(content)
    }

    node.addEventListener('scroll', sync, { passive: true })

    return () => {
      node.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [])
}
