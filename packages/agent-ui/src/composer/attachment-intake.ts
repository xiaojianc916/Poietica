/*
 * 附件从哪里来。
 *
 * 这一层只声明端口，不认识 Tauri —— 收件靠的是原生能力（系统文件对话框、
 * 窗口级拖放、剪贴板），而那些能力属于组合层（见 rules.config.mjs 的
 * nativeAllowed：只有 desktop / desktop-runtime / ipc 三个包碰得到）。
 * 实现由 @poietica/desktop-runtime 装进来，与 installAgentCapabilityPort
 * 是同一种形状，不是第二套做法。
 *
 * 端口交回的是「资产」而不是 File：字节在用户放手的那一刻就已经进了原生的
 * 交付注册表，webview 这一侧从头到尾只拿着一个地址和两个令牌。缩略图直接用
 * 那个地址（poietica-asset://），所以这里没有 object URL，也就没有谁需要
 * 记得撤销它 —— use-object-urls.ts 整个文件因此不存在了。
 */

/** 一张已经在原生交付注册表里的图。 */
export interface ComposerAsset {
  /** 这张图挂在哪条资产会话下。 */
  readonly sessionToken: string
  /** 它在那条会话里的令牌，也就是内容摘要 —— 所以它也是这张图的身份。 */
  readonly assetToken: string
  /** `<img src>` 直接可用的地址。形状由原生发，这一层不拼。 */
  readonly url: string
  /** 屏幕上叫什么。剪贴板里的图没有名字，由实现给一个带时刻的。 */
  readonly filename: string
  /** 由原生按文件头判定，不是渲染层按扩展名的猜测。 */
  readonly mediaType: string
}

export interface AttachmentIntake {
  /** 打开系统文件对话框，把选中的文件入库。取消就是空数组。 */
  readonly pick: (multiple: boolean) => Promise<readonly ComposerAsset[]>
  /** 往窗口里拖文件。交回退订。 */
  readonly watchDrop: (onDropped: (assets: readonly ComposerAsset[]) => void) => () => void
  /** 剪贴板里的一张图。它没有路径，所以只有这一条路要经过字节。 */
  readonly paste: (file: File) => Promise<ComposerAsset>
  /** 从输入框里移掉一张：注册表那一份也该跟着放掉。 */
  readonly discard: (asset: ComposerAsset) => void
}

let installed: AttachmentIntake | null = null

/** 由组合层装上，一个进程一次。重复装是幂等的。 */
export function installAttachmentIntake(intake: AttachmentIntake): void {
  installed = intake
}

/**
 * 现在装着的那一个，没装就是 null。
 *
 * 不抛异常：没有原生收件口的地方（组件用例、fixture、浏览器里跑的 storybook）
 * 输入框照样要画得出来，只是加号点了没有反应 —— 那正是那种环境里应该发生的事。
 */
export function attachmentIntake(): AttachmentIntake | null {
  return installed
}
