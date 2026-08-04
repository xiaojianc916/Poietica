import './disclosure.css'

import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'

/**
 * 一段可以打开的内容。
 *
 * 默认开合是派生的：调用方给什么它就是什么 —— 运行中展开，落定收起。人点过
 * 一次之后以人为准，override 落下就压过这个默认值，此后调用方说什么都不再算。
 *
 * 这个派生曾经被改成一次性初值（useState(defaultOpen)），理由是「落定时的自动
 * 收起会让行高突降，而这一行挂着虚拟器的 measureElement」。那个理由只对了一半：
 * 塌陷本身不是问题，塌陷被补间成 260 毫秒才是 —— 那段时间里每一帧都向测量器
 * 报一次新高度。而那次重排正是这个效果的实现方式，不是它的代价：过渡就写在
 * disclosure.css 里，与这个 hook 同属一处，不必再靠一句转述去描述它。
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

  /*
   * 下一个值从上一个值算出来，不从这一帧的闭包里读。
   *
   * 此前是 setOverride(!isOpen)，而 isOpen 是 override ?? fallback —— 两个都来自
   * 本次渲染的闭包。React 官方对「用上一个 state 算下一个」只给一种写法，就是
   * 更新函数；在这里那不是洁癖，是可复现的：fallback 传进来的是 isRunning /
   * isStreaming，流式期间每帧都可能翻面，而同一批次里的两次点击读的是同一份
   * 闭包 —— 第二次算出与第一次相同的值，面板于是不动。
   *
   * 顺带把 toggle 的身份钉住：它是 <button onClick> 的入参，此前每次渲染都是
   * 一个新函数。
   */
  const toggle = useCallback(() => {
    setOverride((current) => !(current ?? fallback))
  }, [fallback])

  return { isOpen, toggle }
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
 * 类名不再问调用方要。此前它收一个 BEM 前缀去拼 __reveal 与 __clip，理由写的是
 * 「这样每块各有各的作用域，而且不花样式表一分钱」—— 花了：同一套声明在
 * timeline.css 里被抄成两份，并且已经和这里的文档漂移开。机制归这一处，调用方
 * 要覆盖外观照旧加自己的类。
 */
export function DisclosureBody({
  children,
  isOpen,
}: {
  readonly children: ReactNode
  readonly isOpen: boolean
}) {
  return (
    <div className="disclosure__reveal" inert={!isOpen}>
      <div className="disclosure__clip">{children}</div>
    </div>
  )
}
