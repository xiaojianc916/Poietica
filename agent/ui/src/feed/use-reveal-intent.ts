/* poietica:conversation-minimap-jump@v11 */

import { useCallback, useRef, useState } from 'react'

/**
 * 什么算"人自己动了手"。
 *
 * 一次程序化跳转会连续产生几十个 scroll 事件，所以 scroll 不在此列 ——
 * 用它来判定意图，闩锁会被跳转自己解开。这四个是输入设备事件：它们只
 * 可能由人产生。
 *
 * 声明成 readonly string[] 而不是字面量元组：addEventListener 的重载按
 * 事件名收窄监听器类型，喂给它一个联合字面量会让重载解析失败，而这里
 * 用的是同一个无参监听器。
 */
const RELEASING_EVENTS: readonly string[] = ['wheel', 'touchstart', 'keydown', 'pointerdown']

export interface RevealIntent {
  /** 人刚刚要求看的那一行；没有主动跳转时为 null。 */
  readonly row: number | null
  readonly begin: (row: number) => void
  /** 装到滚动区上，返回卸载函数。 */
  readonly watch: (viewport: HTMLElement) => () => void
}

/**
 * 一次跳转在被人接管之前，一直是它说了算。
 *
 * 缩略导航平时从滚动位置反推高亮，这在人自己滚的时候是对的。但点击跳转
 * 期间它是错的：落点尚未稳定，反推出来的是路上经过的轮次，于是高亮会在
 * 跳转的那一瞬间扫过一串别的轮次 —— 那就是"乱跳"被看见的地方。
 *
 * 所以跳转期间高亮的真源换人：由这次点击说了算。它不设时限，也不等滚动
 * 停止 —— 时限是猜的，而 scrollend 的可用性取决于引擎版本。它等的是一个
 * 确定的事实：人下一次自己动手。在那之前，高亮停在人要求的地方，这既是
 * 对的，也是稳的。
 *
 * 闩锁同时是 anchorTo 与 followOnAppend 的依据，所以它必须进 state：策略
 * 要能被声明出来。一次点击一次翻转，代价是一次重渲染。
 */
export function useRevealIntent(): RevealIntent {
  const [row, setRow] = useState<number | null>(null)

  /*
   * 监听器只装一次，所以它不能从闭包里读 row —— 那会读到装载那一刻的值。
   * ref 是这里唯一需要的东西：它只用来回答"现在还闩着吗"。
   */
  const held = useRef<number | null>(null)

  const begin = useCallback((next: number) => {
    held.current = next
    setRow(next)
  }, [])

  const watch = useCallback((viewport: HTMLElement) => {
    const release = () => {
      if (held.current === null) {
        return
      }

      held.current = null
      setRow(null)
    }

    for (const name of RELEASING_EVENTS) {
      viewport.addEventListener(name, release, { passive: true })
    }

    return () => {
      for (const name of RELEASING_EVENTS) {
        viewport.removeEventListener(name, release)
      }
    }
  }, [])

  return { row, begin, watch }
}
