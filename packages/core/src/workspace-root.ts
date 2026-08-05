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
 * 互不隶属的作用域，而一个路径已经是全局唯一的名字了。散列只在需要一个文件名
 * 的时候出场，见 workspaceRootKey。
 */

/**
 * 同一个目录的唯一写法。
 *
 * 反斜杠归一成正斜杠、重复分隔符收成一个、去掉结尾的分隔符、盘符大写 ——
 * 这四条都是「同一个目录的两种写法」的来源，而它们必须先消掉，分组才不会把
 * D:\a 和 d:/a/ 算成两个。根（/ 或 C:/）保留它的结尾分隔符：那一个不是修饰，
 * 是路径本身。
 */
export function normalizeWorkspaceRoot(rootPath: string): string {
  const slashed = rootPath.replaceAll('\\', '/').replaceAll(/\/{2,}/gu, '/')
  const drive = slashed.replace(
    /^([a-z]):/u,
    (_whole, letter: string) => `${letter.toUpperCase()}:`,
  )

  return drive.length > 1 && drive.endsWith('/') && !drive.endsWith(':/')
    ? drive.slice(0, -1)
    : drive
}

/**
 * 人认的那个名字：路径的最后一段。
 *
 * 侧栏那一列窄得放不下一条绝对路径，而项目名足以让人认出来。根目录没有末段，
 * 那时候路径本身就是它的名字。
 */
export function workspaceRootName(rootPath: string): string {
  const segments = normalizeWorkspaceRoot(rootPath)
    .split('/')
    .filter((segment) => segment.length > 0)

  return segments.at(-1) ?? normalizeWorkspaceRoot(rootPath)
}

/**
 * 这个目录落盘时用的文件名，FNV-1a 32 位的八位十六进制。
 *
 * 它不是身份，只是编码：身份是路径（见文件头）。一条绝对路径当不了文件名 ——
 * 它自带分隔符、有长度上限、还分大小写，而原生侧那一层只收 ≤32 位 hex
 * （crates/persistence/src/workspace_state.rs 的 validate_repository_id）。
 *
 * 选 FNV-1a 是因为这里要的就是「短、稳定、纯函数」，不是抗碰撞：撞了两个目录
 * 共用一份工作台标签状态，代价是一次布局错乱，不是安全问题。Math.imul 保证乘法
 * 在 32 位里回绕，与规范一致。
 */
export function workspaceRootKey(rootPath: string): string {
  let hash = 0x811c_9dc5

  for (const character of normalizeWorkspaceRoot(rootPath)) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 0x0100_0193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
