/* poietica:conversation-minimap-jump@v13 */

import { useCallback, useRef, useState } from 'react'

/**
 * 什么算"人自己动了手"。
 *
 * 一次程序化跳转会连续产生几十个 scroll 事件,所以 scroll 不在此列 ——
 * 用它来判定意图,闩锁会被跳转自己解开。这四个是输入设备事件:它们只
 * 可能由人产生。
 *
 * 声明成 readonly string[] 而不是字面量元组:addEventListener 的重载按
 * 事件名收窄监听器类型,喂给它一个联合字面量会让重载解析失败,而这里
 * 用的是同一个无参监听器。
 */
const RELEASING_EVENTS: readonly string[] = ['wheel', 'touchstart', 'keydown', 'pointerdown']

/**
 * 一次尚未了结的跳转请求。
 *
 * seq 让"再点一次同一行"仍然是一次新请求。没有它,重复点击不会产生新的
 * 对象身份,而滚动是作为这个对象的效应发生的 —— 效应不重跑,第二次点击
 * 就没有反应。
 */
export interface Reveal {
  readonly row: number
  readonly seq: number
}

export interface RevealIntent {
  /** 尚未了结的请求;没有则为 null。 */
  readonly pending: Reveal | null
  readonly begin: (row: number) => void
  /**
   * 报告视口顶端此刻是哪一行。到了就了结。
   *
   * 判据是顶行而不是视线行:跳转用 align 'start',它的语义就是"目标行顶边
   * 贴齐视口顶边",所以顶行等于目标行是这次跳转完成的精确定义。用视线行去
   * 判会引入方向性 —— 向上跳时,视线行在开跳之前就已经越过目标了。
   */
  readonly settle: (topRow: number) => void
  /** 装到滚动区上,返回卸载函数。 */
  readonly watch: (viewport: HTMLElement) => () => void
}

/**
 * 一次跳转在了结之前,一直是它说了算。
 *
 * 缩略导航平时从滚动位置反推高亮,这在人自己滚的时候是对的。但点击跳转
 * 期间它是错的:落点尚未稳定,反推出来的是路上经过的轮次,于是高亮会在
 * 跳转的那一瞬间扫过一串别的轮次 —— 那就是"乱跳"被看见的地方。
 *
 * 所以跳转期间高亮的真源换人:由这次点击说了算。它有两种结局,而不是一种:
 * 到达,或者被放弃。只留"被放弃"是个设计缺陷 —— 那条路依赖输入事件必然
 * 发生,而拖动原生滚动条是否派发 pointerdown 并无保证;一旦漏掉,闩锁就永久
 * 挂着,连带把流式跟随也一直关着。到达是自终止的,不依赖任何人再做什么。
 *
 * 闩锁同时是 anchorTo 与 followOnAppend 的依据,所以它必须进 state:策略
 * 要能被声明出来。一次点击一次翻转,代价是一次重渲染。
 */
export function useRevealIntent(): RevealIntent {
  const [pending, setPending] = useState<Reveal | null>(null)

  /*
   * 监听器与同步回调都只装一次,所以它们不能从闭包里读 pending —— 那会读到
   * 装载那一刻的值。ref 是这里唯一需要的东西:它只用来回答"现在还闩着吗、
   * 闩的是哪一行"。
   */
  const held = useRef<Reveal | null>(null)
  const issued = useRef(0)

  const begin = useCallback((row: number) => {
    issued.current += 1

    const next: Reveal = { row, seq: issued.current }

    held.current = next
    setPending(next)
  }, [])

  const finish = useCallback(() => {
    if (held.current === null) {
      return
    }

    held.current = null
    setPending(null)
  }, [])

  const settle = useCallback(
    (topRow: number) => {
      if (held.current === null || held.current.row !== topRow) {
        return
      }

      finish()
    },
    [finish],
  )

  const watch = useCallback(
    (viewport: HTMLElement) => {
      for (const name of RELEASING_EVENTS) {
        viewport.addEventListener(name, finish, { passive: true })
      }

      return () => {
        for (const name of RELEASING_EVENTS) {
          viewport.removeEventListener(name, finish)
        }
      }
    },
    [finish],
  )

  return { pending, begin, settle, watch }
}
