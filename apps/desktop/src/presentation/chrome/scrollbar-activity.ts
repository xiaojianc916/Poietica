/*
 * 滚动条只在滚动时露面,而这件事只需要一个监听器。
 *
 * scroll 不冒泡,但捕获阶段在 document 上收得到任意滚动盒的 scroll,
 * event.target 就是那个盒子。所以这里不给每个滚动容器各挂一份 hook ——
 * 那会让 AI 面板同时有两个滚动订阅者(还有一个是贴底),也会让"滚动条会不会
 * 露面"取决于组件有没有记得接上。装一次,全窗口一致。
 *
 * 停留时长是设计决定,写在令牌层,这里读同一个值。
 */

const LINGER_TOKEN = '--desktop-scrollbar-linger'
const FALLBACK_LINGER_MS = 1000
const SCROLLING_ATTRIBUTE = 'data-scrolling'

/** 装上窗口级的滚动活动标记。返回卸载函数,供测试使用。 */
export function installScrollbarActivity(): () => void {
  const linger = readLingerMs()
  const pending = new WeakMap<Element, number>()

  const onScroll = (event: Event) => {
    const scroller = event.target

    if (!(scroller instanceof Element)) {
      return
    }

    const scheduled = pending.get(scroller)

    if (scheduled !== undefined) {
      window.clearTimeout(scheduled)
    }

    scroller.setAttribute(SCROLLING_ATTRIBUTE, '')

    pending.set(
      scroller,
      window.setTimeout(() => {
        pending.delete(scroller)
        scroller.removeAttribute(SCROLLING_ATTRIBUTE)
      }, linger),
    )
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true })
  }
}

/** 令牌以毫秒书写;读不到就用兜底值,滚动条永远不会因此卡在显形状态。 */
function readLingerMs(): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue(LINGER_TOKEN)
  const milliseconds = Number.parseFloat(declared)

  if (Number.isFinite(milliseconds) && milliseconds > 0) {
    return milliseconds
  }

  return FALLBACK_LINGER_MS
}
