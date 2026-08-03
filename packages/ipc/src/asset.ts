import { throughIpc } from './error'
import { type AssetUploadResult, commands } from './generated/ipc-bindings'

/*
 * 资产会话：一批图片挂在一个令牌下面，关掉就一起释放。
 *
 * 这一层只做一件事 —— 把原生那三条命令包成"一次调用只有一条路"的形状（见
 * error.ts 的 throughIpc）。形状不在这里重新定义：AssetUploadResult 直接取自
 * 生成绑定，Rust 侧的类型是权威。
 *
 * 字节不出现在这个文件里，也不出现在任何一条命令的参数里。拖放与文件对话框
 * 交给渲染层的是路径，读盘发生在原生侧：webview 不该为了把一张 4 MB 的 PNG
 * 交给本机进程，先把它读进内存、编码、再送回去。
 */

/** 原生按路径入库之后交回来的那一份。source 就是 <img src> 能直接用的地址。 */
export type AssetImport = AssetUploadResult

/** 开一条资产会话，拿到它的令牌。 */
export function openAssetSession(): Promise<string> {
  return throughIpc(async () => {
    const opened = await commands.assetSessionOpen()

    return opened.sessionToken
  })
}

/**
 * 把这些路径读进会话，顺序与传入一致。
 *
 * 内容类型由原生按文件头判定，不看扩展名，也不看渲染层的猜测；认不出来的格式
 * 整批拒绝，所以调用方拿到的每一项都是能投递的。
 */
export function importAssets(
  sessionToken: string,
  paths: readonly string[],
): Promise<readonly AssetImport[]> {
  /* readonly 的数组与生成绑定要的可变数组是两个类型，所以复制一次 ——
  与 agent.ts 里 nativeLaunch 同一个理由，也只在这一层做。 */
  return throughIpc(() => commands.assetImport({ sessionToken, paths: [...paths] }))
}

/** 关掉会话，它持有的字节与地址一并作废。已经不在了也算成功。 */
export function closeAssetSession(sessionToken: string): Promise<void> {
  return throughIpc(async () => {
    await commands.assetSessionClose({ sessionToken })
  })
}
