import type { PromptImage } from '@poietica/acp'

/*
 * 附件变成协议认得的东西。
 *
 * ACP 的 image content block 要的是 base64 的字节与一个 mimeType，所以这里读
 * 一次 arrayBuffer 就够了 —— 不落盘，不建 URL，不经过任何注册表。
 *
 * 只有图片走这条路。别的文件类型协议里有别的块（resource / resource_link），
 * 它们各有各的形状，不该被塞进一个图片块里冒充图片。
 */

/** 一次转 32 KiB。String.fromCharCode 的参数个数是有上限的，整张图铺开会爆栈。 */
const CHUNK = 0x8000

const isImage = (file: File): boolean => file.type.startsWith('image/')

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
 */
export async function toPromptImages(files: readonly File[]): Promise<readonly PromptImage[]> {
  return Promise.all(
    files.filter(isImage).map(async (file) => ({
      data: base64Of(await file.arrayBuffer()),
      mimeType: file.type,
    })),
  )
}
