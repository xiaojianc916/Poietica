import { useCallback } from 'react'

/* poietica:conversation-minimap-card@v24 */

const TURN = '.conversation-minimap__turn'
const CARD = '.conversation-minimap__card'
const SHOWN = 'data-shown'

/**
 * 一张卡片,在轨道上滑动。
 *
 * 原先是一格一张卡片。换格时旧的立刻开始淡出、新的等 90ms 才淡入,而两张卡片
 * 的锚点只差 13px、卡片本身高四五十像素 —— 于是中间那一百多毫秒里两张半透明
 * 的卡片几乎完全重叠。看上去不是"切换",是穿模。而且那 90ms 每跨一格重计一次,
 * 扫过二十格就是二十轮淡出淡入。把过渡调长只会让重叠期更长。
 *
 * 所以换成共享元素:整条轨道只有一张卡片,换格时它沿轨道滑过去,文字同时换掉。
 * 两张卡片永远不会共存,穿模无从发生。延迟只在"从无到有"时计一次 —— 已经显示
 * 着的时候换格是零延迟的纯位移,这正是 Radix 的 skipDelayDuration 在做的事。
 *
 * 指针状态不进 React。use-fisheye 里那句注释同样适用:指针扫过轨道会把整条
 * 记录重渲染一遍。这里只在跨格时动一下 DOM,不惊动 React。
 */
export function useRailCard(): (node: HTMLElement | null) => (() => void) | undefined {
  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return undefined
    }

    const view = node.ownerDocument.defaultView

    if (view === null) {
      return undefined
    }

    /* 两个时长仍然留在样式表里 —— 它们是观感参数,不是逻辑。挂载时读一次。 */
    const ms = (name: string, fallback: number): number => {
      const value = Number.parseFloat(view.getComputedStyle(node).getPropertyValue(name))

      return Number.isFinite(value) ? value : fallback
    }

    const enterMs = ms('--cp-rail-card-delay', 90)
    const leaveMs = ms('--cp-rail-card-leave', 60)

    let enterTimer = 0
    let leaveTimer = 0
    let current: HTMLElement | null = null

    /*
     * 三个来源,一个答案。
     *
     * 键盘焦点压过指针:人按了 Tab 就是在用键盘,这时候鼠标停在哪里是历史遗留。
     * data-aimed 压过 :hover,因为鱼眼的判定范围向左探出 28px —— 指针还没压到
     * 轨道上,预览就该出来了,这是原来的行为,不能因为换了实现就丢掉。
     * :hover 兜底:粗指针和减弱动效两种情况下鱼眼直接提前返回,不写 data-aimed。
     */
    const targetOf = (): HTMLElement | null =>
      node.querySelector<HTMLElement>(`${TURN}:focus-visible`) ??
      node.querySelector<HTMLElement>(`${TURN}[data-aimed]`) ??
      node.querySelector<HTMLElement>(`${TURN}:hover`)

    const fill = (box: HTMLElement, turn: HTMLElement): void => {
      const kicker = box.querySelector<HTMLElement>('.conversation-minimap__card-kicker')
      const question = box.querySelector<HTMLElement>('.conversation-minimap__card-question')
      const reply = box.querySelector<HTMLElement>('.conversation-minimap__card-reply')
      const kickerText = turn.getAttribute('data-card-kicker')
      const replyText = turn.getAttribute('data-card-reply')

      if (kicker !== null) {
        kicker.textContent = kickerText ?? ''
        kicker.hidden = kickerText === null
      }

      if (question !== null) {
        question.textContent = turn.getAttribute('data-card-label') ?? ''
      }

      if (reply !== null) {
        reply.textContent = replyText ?? ''
        reply.hidden = replyText === null
      }

      /* 定位到这一格的中线。卡片是 nav 的绝对定位子节点,量的是格子在 nav 里的位置。 */
      box.style.setProperty('--cp-card-y', `${String(turn.offsetTop + turn.offsetHeight / 2)}px`)
    }

    const settle = (): void => {
      const box = node.querySelector<HTMLElement>(CARD)

      if (box === null) {
        return
      }

      const turn = targetOf()

      if (turn === null) {
        view.clearTimeout(enterTimer)
        enterTimer = 0

        if (current === null) {
          return
        }

        current = null

        /*
         * 宽限期。擦着边缘划过去、或者从一格到另一格中间掠过一片空白,不该让
         * 卡片闪一下。这段时间里 data-shown 还在,所以真回来了就只是接着滑。
         */
        leaveTimer = view.setTimeout(() => {
          leaveTimer = 0
          box.removeAttribute(SHOWN)
        }, leaveMs)

        return
      }

      if (turn === current) {
        return
      }

      view.clearTimeout(leaveTimer)
      leaveTimer = 0
      current = turn
      fill(box, turn)

      /*
       * 已经显示着就到此为止:位置刚写完,CSS 会把它滑过去,零延迟、不淡出。
       *
       * 还没显示才计时,而且只计一次 —— 延迟是"你确实想看"的门槛,不是每格
       * 都要重新翻越一遍的栏杆。这段时间里位置照写,只是看不见,所以门槛过了
       * 之后卡片是直接在正确的地方淡出来,不会从上一格飘过来。
       */
      if (box.hasAttribute(SHOWN) || enterTimer !== 0) {
        return
      }

      enterTimer = view.setTimeout(() => {
        enterTimer = 0
        box.setAttribute(SHOWN, '')
      }, enterMs)
    }

    /*
     * 两个观察者,不是一个。
     *
     * 同一个 MutationObserver 对同一个节点再 observe 一次是替换而不是叠加,而
     * 这两件事要的范围正好相反:格子的增删只发生在 nav 的直接子节点上,不要
     * subtree;data-aimed 挂在格子上,要 subtree。合成一个就得开 subtree 的
     * childList,而 fill() 写 textContent 恰恰就是 subtree 的 childList 变更 ——
     * 那是一个自己喂自己的循环。
     */
    const structure = new view.MutationObserver(settle)
    const aim = new view.MutationObserver(settle)

    structure.observe(node, { childList: true })
    aim.observe(node, { attributeFilter: ['data-aimed'], subtree: true })

    node.addEventListener('pointerover', settle)
    node.addEventListener('pointerleave', settle)
    node.addEventListener('focusin', settle)
    node.addEventListener('focusout', settle)

    return () => {
      view.clearTimeout(enterTimer)
      view.clearTimeout(leaveTimer)
      structure.disconnect()
      aim.disconnect()
      node.removeEventListener('pointerover', settle)
      node.removeEventListener('pointerleave', settle)
      node.removeEventListener('focusin', settle)
      node.removeEventListener('focusout', settle)
    }
  }, [])
}
