import { useCallback } from 'react'

const CLEARANCE = '--cp-dock-clearance'

/**
 * 输入框盖在转录上，所以转录的末端要空出它那么高。
 *
 * 这个高度 CSS 拿不到：输入框是滚动盒的兄弟，而兄弟的尺寸没有任何选择器能
 * 读到。它也不是常量 —— 草稿变长、附件挂上去，输入框都会长高。所以这一次
 * 测量是必需的，不是偷懒。
 *
 * 量出来的数写成一个自定义属性，交给尾部的下内边距；尾部的实测高度本来就是
 * 虚拟器的 paddingEnd。于是末端仍然只有一个定义，这里没有新增第二条管线，
 * 只是给现成的那条换了个数。
 *
 * 直接在观察者回调里写，不推到 rAF。use-stick-to-bottom 那里推是因为它写
 * scrollTop 会改布局、再触发下一轮通知；这里被写的属性只被滚动盒内部的尾部
 * 消费，改不动输入框自己的高度，成不了环。同一个坑要看清是不是同一个坑。
 *
 * 属性写在父元素上：这个 ref 挂在输入框那条带子上，而带子的父元素就是
 * assistant-surface —— JSX 里紧挨着，不需要 closest() 去猜。
 */
export function useDockClearance(): (node: HTMLElement | null) => void {
  return useCallback((node: HTMLElement | null) => {
    const surface = node?.parentElement ?? null

    if (node === null || surface === null) {
      return
    }

    const observer = new ResizeObserver(() => {
      surface.style.setProperty(CLEARANCE, `${String(node.offsetHeight)}px`)
    })

    observer.observe(node)

    return () => {
      observer.disconnect()
      surface.style.removeProperty(CLEARANCE)
    }
  }, [])
}
