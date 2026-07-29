/*
 * 一个 ACP agent 的档案长什么样。
 *
 * ACP 只规定协议本身。协议之上每一家仍有自己的写法：用什么命令启动、把一道
 * 题塞进 session/request_permission 时 optionId 长什么样、终局帧到达后屏幕上
 * 该剩下什么。这些不是协议的漏洞，是协议留给实现的自由。
 *
 * 档案就是把这份自由收成一张表。收法只有两种，判据只有一条：
 *
 *   各家不同的是「值」   → 声明字段。通用层那段代码对所有 agent 是同一份。
 *   各家不同的是「算法」 → 钩子函数。通用层没法靠换一个参数伺候第二家。
 *
 * 默认走声明。要用钩子，必须在档案里写清为什么声明不够 —— 没写理由的钩子只是
 * 把一个 if 换了个地方，不是解耦。
 *
 * 今天一个钩子都没有：已经发现的各家差异全都落在「值」这一侧。判据仍然写在
 * 这里，是为了将来真需要钩子时有个门槛 —— 一份档案至多一个，签名钉死，纯函数
 * （不碰全局状态、界面、网络、时钟），只在入站边界调用，通用层只有一个调用点。
 */

/**
 * 「向用户提问」在这一家的写法。
 *
 * 提问不是 ACP 的概念，协议只有 session/request_permission。哪一家用什么形状的
 * optionId 把一道题塞进权限请求，是那一家的方言。
 *
 * 各家不同的只有这两条正则；通用层拿到之后干的事一模一样：exec，取两个捕获组，
 * 一个题号一个选项号。换第二家一行代码都不用改 —— 变的只是值，所以是声明。
 */
export interface AcpQuestionDialect {
  /** 捕获 (题号, 选项号)。 */
  readonly option: RegExp
  /** 捕获 (题号)。 */
  readonly skip: RegExp
}

export interface AcpAgentDescriptor {
  readonly id: string
  readonly displayName: string
  /** 可执行文件名，不含参数。 */
  readonly command: string
  readonly args: readonly string[]
  /**
   * 权限选项按钮上写什么。
   *
   * 键是这一家送来的 name（协议里的 human-readable label），不是 kind：kind 是
   * 分类，一次请求里会重复，拿它当标签会让几个不同的选项显示成同一个词。
   * 查不到的一律照原文显示，所以这张表只需要列出想改口的那几条。
   *
   * 各家不同的只是这张表，通用层查表那一行对谁都一样 —— 变的是值，所以是声明。
   */
  readonly optionLabels: Readonly<Record<string, string>>
  /** 缺席表示这一家不用权限请求提问。 */
  readonly questionDialect?: AcpQuestionDialect | undefined
}
