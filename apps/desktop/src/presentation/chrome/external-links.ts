import { invoke } from '@poietica/platforms-desktop-ipc'

/**
 * 外链归系统浏览器。
 *
 * 主窗口是 decorations: false —— 没有地址栏，没有后退。webview 一旦导航到外站，
 * 应用就被那张网页替换掉，且没有任何回来的路径。在此之前，AI 回答里的每一个引用
 * 链接、设置页里的每一个 apiKeysUrl，点下去都是这个结果。
 *
 * 用委托而不是逐个组件接管：链接的来源太多（Streamdown 正文、它自己的 link-safety
 * 弹窗、设置页、错误面板），逐处接管既漏又要各自复制一遍判断。capture 阶段一个
 * 监听，谁也漏不掉，而且没有任何组件需要知道它的存在。
 */

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 只认左键裸点击：中键、Ctrl/Cmd 点击在桌面语义里都是"另开"，系统浏览器本来就会另开。 */
function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

function externalHrefOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null
  }

  const anchor = target.closest('a[href]')

  if (!(anchor instanceof HTMLAnchorElement)) {
    return null
  }

  /*
   * 走 anchor.href 而不是 getAttribute('href')：前者已经由引擎解析成绝对 URL，
   * 相对路径、协议相对路径、`#` 锚点的差别在这里已经被抹平。
   */
  let url: URL

  try {
    url = new URL(anchor.href, document.baseURI)
  } catch {
    return null
  }

  return EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null
}

export function installExternalLinks(): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!isPlainLeftClick(event)) {
      return
    }

    const href = externalHrefOf(event.target)

    if (href === null) {
      return
    }

    event.preventDefault()

    void invoke('window_open_external_url', { url: href }).catch((cause: unknown) => {
      console.error('[Poietica] Failed to open an external link', cause)
    })
  }

  document.addEventListener('click', onClick, { capture: true })

  return () => {
    document.removeEventListener('click', onClick, { capture: true })
  }
}
