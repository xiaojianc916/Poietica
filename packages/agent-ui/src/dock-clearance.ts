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
 * 虚拟器的 paddingEnd。于是末端仍然只有一个定义，这里没有新增第二条管线。
 *
 * 高度取自 entry.borderBoxSize —— 那是浏览器刚刚量好、免费交到手上的值。此前
 * 这里读 node.offsetHeight：那是一次强制同步布局，而它就在「打字时输入框长高」
 * 这条高频路上。同一个数，两种代价。
 *
 * 值没变就不写：一次观察不等于一次变化（父级布局抖一下也会通知），而写属性
 * 会让消费它的滚动盒尾部重新算内边距。
 *
 * 直接在观察者回调里写，不推到 rAF。会成环的是另一种写法 —— 回调里改的东西又会
 * 改回它自己观察的那个尺寸；这里被写的属性只被滚动盒内部的尾部消费，改不动输入
 * 框自己的高度，成不了环。
 *
 * 属性写在父元素上：这个 ref 挂在输入框那条带子上，而带子的父元素就是
 * assistant-surface —— JSX 里紧挨着，不需要 closest() 去猜。
 */
export function useDockClearance(): (node: HTMLElement | null) => void {
  return useCallback((node: HTMLElement | null) => {
    const surface = node?.parentElement ?? null

    if (node === null || surface === null) {
      return undefined
    }

    let written = -1

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.borderBoxSize?.[0]?.blockSize
      const height = measured === undefined ? node.offsetHeight : Math.round(measured)

      if (height === written) {
        return
      }

      written = height
      surface.style.setProperty(CLEARANCE, height + 'px')
    })

    observer.observe(node)

    return () => {
      observer.disconnect()
      surface.style.removeProperty(CLEARANCE)
    }
  }, [])
}
