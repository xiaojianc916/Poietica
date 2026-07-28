/**
 * 把一个元素按在它此刻的位置上，直到一次尺寸变化走完。
 *
 * 会话流的滚动位置归虚拟器所有，而它的锚点是末端（anchorTo: 'end'）—— 对流式
 * 输出这是对的，新内容在下面长出来，人要跟着看最新一条。但同一套补偿会把「人
 * 点开了一个抽屉」也当成末端要保持不动：被点的那一行长高多少，滚动偏移就补上
 * 多少，于是那一行被顶出视口。展开应该朝下发生，被点的地方不该移动。
 *
 * 所以这里不改锚点归属，只在这一次交互里借用它：记下锚点相对滚动区的位置，
 * 逐帧把漂移加回 scrollTop。
 *
 * 为什么是逐帧而不是改一次：长高本身是逐帧发生的 —— 抽屉在 0fr 与 1fr 之间
 * 补间，虚拟器的 measureElement 又通过 ResizeObserver 分批读回高度。只纠正一
 * 次，会被下一帧的补偿重新推走。
 *
 * 人一旦自己开始滚（wheel / touchmove），立刻放手：这套机制的全部意义是不夺
 * 走视线，为此它必须先肯放弃自己。
 */

/** 按住的时长。略长于抽屉的 --cp-motion-drawer（260ms），留出测量回填的余量。 */
const HOLD_MS = 420

/** 小于半个像素的漂移不值得写回 scrollTop：那只会制造无休止的微抖。 */
const DRIFT_EPSILON_PX = 0.5

/**
 * 锚点所在的滚动区。
 *
 * 按 overflow-y 的计算值找，而不是按类名 —— 思考链内部那个带上限的小滚动盒也
 * 是合法答案，且它才是离锚点最近的那个。同时要求它真的溢出：一个 overflow:
 * auto 但没有内容可滚的盒子按不住任何东西。
 */
function findScroller(node: HTMLElement | null): HTMLElement | null {
  for (let cursor = node; cursor !== null; cursor = cursor.parentElement) {
    const overflowY = getComputedStyle(cursor).overflowY

    const scrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'

    if (scrollable && cursor.scrollHeight > cursor.clientHeight) {
      return cursor
    }
  }

  return null
}

export function keepInPlace(anchor: HTMLElement | null, holdMs: number = HOLD_MS): void {
  if (anchor === null || typeof requestAnimationFrame !== 'function') {
    return
  }

  const scroller = findScroller(anchor)

  if (scroller === null) {
    return
  }

  const offsetOf = () => anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top

  const target = offsetOf()
  const deadline = performance.now() + holdMs
  const release = new AbortController()

  /*
   * 只听滚动手势。pointerdown 与 keydown 都在 click 之前触发，听它们等于每次
   * 展开都当场放手 —— 那就什么也没修。
   */
  for (const type of ['wheel', 'touchmove'] as const) {
    scroller.addEventListener(
      type,
      () => {
        release.abort()
      },
      {
        passive: true,
        signal: release.signal,
      },
    )
  }

  const tick = () => {
    if (release.signal.aborted) {
      return
    }

    const drift = offsetOf() - target

    if (Math.abs(drift) > DRIFT_EPSILON_PX) {
      scroller.scrollTop += drift
    }

    if (performance.now() < deadline) {
      requestAnimationFrame(tick)
      return
    }

    release.abort()
  }

  requestAnimationFrame(tick)
}
