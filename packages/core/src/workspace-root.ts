/*
 * 一个工作目录的身份、它的名字，以及它落盘时的文件名。
 *
 * 住在第 0 层，因为它有两个消费者，而它们跨着分层：agent-session（第 2 层）
 * 按它给会话分组，workspace（第 4 层）按它记工作台状态。第 2 层不许依赖第 4 层，
 * 所以这条规则此前只能各写一份 —— agent-session 拿原始路径当 id、自己 split 取
 * 末段；workspace 另有 normalizeRootPath / deriveRepositoryName。同一个概念两套
 * 算法，必然分叉。
 *
 * 身份就是归一化之后的路径本身，不是它的散列：D:\a 与 D:\a\b 是两个平级、
 * 互不隶属的作用域，而一条路径已经是全局唯一的名字了。散列只在需要一个文件名
 * 的时候出场，见 workspaceRootKey。
 *
 * 下面三个实现是从 packages/workspace/src/domain/repository.ts 逐字节搬来的，
 * 只统一了形参名：搬家不改语义。此前这里被顺手重写过一遍，代价是三处静默漂移
 * —— 少了 .trim()、C:/ 的结尾分隔符被保留、散列从 UTF-16 码元换成了码点。
 * 归一化要不要再管 NFC、. 与 ..、UNC 路径，是另一件事，得单独一笔带测试地改。
 */

/**
 * 同一个目录的唯一写法。
 *
 * 反斜杠归一成正斜杠、重复分隔符收成一个、去掉结尾的分隔符、盘符大写 ——
 * 这四条都是「同一个目录的两种写法」的来源，而它们必须先消掉，分组才不会把
 * D:\a 和 d:/a/ 算成两个。
 */
export function normalizeWorkspaceRoot(rootPath: string): string {
  const unified = rootPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
  const driveCased = unified.replace(
    /^([a-z]):\//,
    (_match, drive: string) => `${drive.toUpperCase()}:/`,
  )
  const trimmed = driveCased.replace(/\/+$/, '')

  return trimmed.length > 0 ? trimmed : '/'
}

/**
 * 人认的那个名字：路径的最后一段。
 *
 * 侧栏那一列窄得放不下一条绝对路径，而项目名足以让人认出来。根没有末段，
 * 那时候路径本身就是它的名字。
 */
export function workspaceRootName(rootPath: string): string {
  const normalized = normalizeWorkspaceRoot(rootPath)
  const lastSlash = normalized.lastIndexOf('/')
  const tail = lastSlash < 0 ? normalized : normalized.slice(lastSlash + 1)

  return tail.length > 0 ? tail : normalized
}

/**
 * 这个目录落盘时用的文件名，FNV-1a 32 位的八位十六进制。
 *
 * 它不是身份，只是编码：身份是路径（见文件头）。一条绝对路径当不了文件名 ——
 * 它自带分隔符、有长度上限、还分大小写，而原生侧那一层只收 ≤32 位 hex
 * （crates/persistence/src/workspace_state.rs 的 validate_repository_id）。
 *
 * 选 FNV-1a 是因为这里要的就是「短、稳定、纯函数」，不是抗碰撞：撞了两个目录
 * 共用一份工作台标签状态，代价是一次布局错乱，不是安全问题。Math.imul 保证
 * 乘法在 32 位里回绕，与规范一致。
 */
export function workspaceRootKey(rootPath: string): string {
  const normalized = normalizeWorkspaceRoot(rootPath)
  let hash = 0x811c9dc5

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
