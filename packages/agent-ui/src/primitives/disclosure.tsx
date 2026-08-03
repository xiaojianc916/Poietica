import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * 一段可以打开的内容。
 *
 * 默认开合是派生的：调用方给什么它就是什么 —— 运行中展开，落定收起。人点过
 * 一次之后以人为准，override 落下就压过这个默认值，此后调用方说什么都不再算。
 *
 * 这个派生曾经被改成一次性初值（useState(defaultOpen)），理由是「落定时的自动
 * 收起会让行高突降，而这一行挂着虚拟器的 measureElement」。那个理由只对了一半：
 * 塌陷本身不是问题，塌陷被补间成 260 毫秒才是 —— 那段时间里每一帧都向测量器
 * 报一次新高度。补间已经拆掉（timeline.css 的两条 __reveal 现在只过渡 opacity），
 * 收起因此是一次跳变、一次重排。
 *
 * 所以两件事各归各：要不要自动收起是产品判断，抖不抖是实现问题。用前者去绕开
 * 后者，等于拿一个行为改动去掩盖一段本来就不该存在的动画。
 */
export function useDisclosure(fallback: boolean): {
  readonly isOpen: boolean
  readonly toggle: () => void
} {
  const [override, setOverride] = useState<boolean | null>(null)

  const isOpen = override ?? fallback

  return {
    isOpen,
    toggle: () => {
      setOverride(!isOpen)
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
 * 过渡期间每一帧都会向虚拟器的 measureElement 报一次新高度，下面的行因此跟着
 * 平滑下移。这一条被当作删掉过渡的理由用过一次，那是错的：重排是这个效果的
 * 实现方式，不是它的代价。
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
