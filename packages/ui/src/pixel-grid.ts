/*
 * 设备像素网格。
 *
 * CSS 没有 env(device-pixel-ratio)，但要把描边和发丝线对齐到物理像素就必须
 * 知道它。这里把 devicePixelRatio 写成一个无单位的自定义属性，令牌层即可用
 * calc() 从它推出图标基本单位与发丝线宽度。
 *
 * Windows 的缩放是按显示器的，窗口跨屏拖动时 dpr 会变。matchMedia 对
 * resolution 的查询只在越过某个具体值时触发，所以每次变化之后都要按新的
 * dpr 重新注册一次监听，否则只能捕捉到第一次变化。
 */

let disconnect: (() => void) | undefined

export function trackDevicePixelRatio(): () => void {
  const root = document.documentElement

  const observe = (): void => {
    const ratio = window.devicePixelRatio || 1

    root.style.setProperty('--ui-dpr', String(ratio))

    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const onChange = (): void => {
      query.removeEventListener('change', onChange)
      observe()
    }

    query.addEventListener('change', onChange)

    disconnect = () => {
      query.removeEventListener('change', onChange)
    }
  }

  disconnect?.()
  observe()

  return () => {
    disconnect?.()
    disconnect = undefined
  }
}
