import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * 一段可以打开的内容。
 *
 * 默认开合只在挂载那一刻问一次，之后归读者。
 *
 * 此前它是每帧派生的：isOpen = override ?? fallback，而两个调用点传进来的
 * fallback 分别是 isStreaming 与 isRunning。于是一次运行结束的那一刻，面板
 * 替用户按了一下折叠 —— 没有人点过它，行高却突降一截，而这一行挂着虚拟器的
 * measureElement，它后面每一行的位置都要重算。那就是那阵「莫名其妙的抖动」。
 * 它还解释了为什么时有时无：点过一次之后 override 非空，派生就失效了。
 *
 * 业界没有一家这么做。VS Code 的输出面板、Xcode 的 build log、Cursor 的工具
 * 卡片，任务跑完都不会自动折叠 —— 展开状态是读者的，一旦交出去就不再收回。
 * 「运行中默认展开」是个好默认，但默认的意思就是只在开头说一次。
 *
 * 这也正是 React 官方对「用 prop 当 state 初始值」给的写法：useState(prop)，
 * 而不是一个每次渲染都重新求值的派生量。
 */
export function useDisclosure(defaultOpen: boolean): {
  readonly isOpen: boolean
  readonly toggle: () => void
} {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return {
    isOpen,
    toggle: () => {
      setIsOpen(!isOpen)
    },
  }
}

/**
 * The travelling part of a disclosure.
 *
 * The content stays mounted: unmounting it is why a panel snaps instead of
 * opening, as there is nothing to animate between a node and no node. It lives
 * in a grid row that travels between 0fr and 1fr, the one way an intrinsic
 * height animates without being measured in script. Closed, the row is inert,
 * so its content is out of reach of the keyboard and of a screen reader.
 *
 * The BEM prefix stays with the caller, so each panel keeps its own scope and
 * sharing this costs the stylesheet nothing.
 */
export function DisclosureBody({
  block,
  children,
  isOpen,
}: {
  readonly block: string
  readonly children: ReactNode
  readonly isOpen: boolean
}) {
  return (
    <div className={`${block}__reveal`} inert={!isOpen}>
      <div className={`${block}__clip`}>{children}</div>
    </div>
  )
}
