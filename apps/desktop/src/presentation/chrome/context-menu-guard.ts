/**
 * 原生右键菜单归零，可编辑元素除外。
 *
 * 主窗口是 decorations: false，而 WebView2 的页面右键菜单给的是「返回 / 刷新 /
 * 另存为 / 打印 / 检查」。这不是多余，是危险：刷新会重载整个 SPA、内存里的对话
 * 状态全丢；另存为把应用的 HTML 写到磁盘；返回让唯一的 webview 导航走 —— 正是
 * external-links.ts 文件头描述的那个回不来的局面。
 *
 * 为什么在这一层拦，而不是关 WebView2 的 AreDefaultContextMenusEnabled：那个
 * 开关 Tauri 2.5 没有配置化，要自己接 webview2-com，而且只管 Windows。这个仓库
 * 对「全局、跨组件、谁也不该知道」这类问题已经选定了做法 —— 见 external-links
 * .ts 那条 document 级 capture 监听。同类问题用同一条管线，不新开机制。
 *
 * 可编辑元素放行不是妥协，是精确：在 input / textarea / contenteditable 上
 * WebView2 出的是编辑菜单（剪切 / 复制 / 粘贴），危险项恰好全在非编辑那一张菜单
 * 上。而应用目前没有自绘右键菜单，一刀切会让输入框失去鼠标粘贴且没有替代 —— 那
 * 是纯亏。Discord、Slack、VS Code 在自绘菜单落地之前都是这么处理的。等到有了自
 * 绘菜单，这里改成无条件拦下，由那个菜单接管。
 */

const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null
}

export function installContextMenuGuard(): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    /*
     * 已经被拦过就不再插手：将来自绘菜单会在冒泡阶段自己 preventDefault，
     * 这里没有理由重复表态。
     */
    if (event.defaultPrevented || isEditable(event.target)) {
      return
    }

    event.preventDefault()
  }

  document.addEventListener('contextmenu', onContextMenu, { capture: true })

  return () => {
    document.removeEventListener('contextmenu', onContextMenu, { capture: true })
  }
}
