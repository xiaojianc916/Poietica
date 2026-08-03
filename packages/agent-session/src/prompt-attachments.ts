import type { PromptImage } from '@poietica/acp'

/*
 * 附件变成协议认得的东西。
 *
 * ACP 的 image content block 要的是 base64 的字节与一个 mimeType，所以这里读
 * 一次 arrayBuffer 就够了 —— 不落盘，不建 URL，不经过任何注册表。
 *
 * 收什么不在这一层判。判据在收件口（prompt-input.tsx 的 accepted），拖、粘、
 * 选三条路共用它，所以走到这里的一定已经是图片。此前这里还站着第二条
 * filter(isImage)：进得了框却发不出去 —— 一个 PDF 会长出一张卡片，然后在这一
 * 行被悄悄丢掉，对面收到一句没有附件的话，屏幕上什么都没说。同一件事两处各
 * 判一次，判得还不一样，中间隔着用户看得见的界面。
 *
 * 别的文件类型协议里有别的块（resource / resource_link），它们各有各的形状，
 * 不该被塞进一个图片块里冒充图片 —— 那是收件口那一侧要扩的事。
 */

/** 一次转 32 KiB。String.fromCharCode 的参数个数是有上限的，整张图铺开会爆栈。 */
const CHUNK = 0x8000

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }

  return btoa(binary)
}

/**
 * 把附件里的图片读成协议要的形状，顺序与用户挑的一致。
 *
 * 读文件是异步的，所以这是发送路径上唯一需要等待的一步。等的是几毫秒的
 * arrayBuffer，不是一次往返。
 *
 * 这里不写 async：函数体交出去的本来就是 Promise.all 那一个 promise，加上
 * async 只是把它拆开再包一遍，调用方等到的是同一个东西。
 */
export function toPromptImages(files: readonly File[]): Promise<readonly PromptImage[]> {
  return Promise.all(
    files.map(async (file) => ({
      data: base64Of(await file.arrayBuffer()),
      mimeType: file.type,
    })),
  )
}
