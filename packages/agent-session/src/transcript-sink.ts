import type { ThreadAttachment, ThreadHistory } from '@poietica/acp'

/**
 * 转录那一侧，只要这四句话。
 *
 * 打开一条对话现在会把它的经过一起带回来，而经过归转录 store 管。注入而不是
 * import 那个单例：这个文件自己在下面说过，模块级可变量让测试拿不到干净实例。
 * 声明成一个只有三个方法的接口，是为了让测试能塞一个假的进来。
 */
export interface TranscriptSink {
  readonly opening: (threadId: string) => void
  readonly adopt: (
    threadId: string,
    events: readonly unknown[],
    history: ThreadHistory,
    attachments: readonly ThreadAttachment[],
    prompts: number,
  ) => void
  readonly failed: (threadId: string, cause: unknown) => void
  /** 运行帧按会话号到达，而这一侧的一切按对话记：这是两者之间唯一的那张表。 */
  readonly route: (sessionId: string, threadId: string) => void
  /** 这条对话不存在了：转录连同指向它的路由一起作废。 */
  readonly forget: (threadId: string) => void
  /**
   * 这条对话此刻有没有一轮在飞。
   *
   * 权威是转录自己的 status（RunStatus 的 running / awaiting_permission），不另记
   * 一张在飞表：同一个事实两处维护，迟早各说各的。转录已经逐帧维护着它，输入框
   * 那一侧读的也是同一格（useAssistantSession 的 toChatStatus）。
   */
  readonly busy: (threadId: string) => boolean
  /** 某条对话从忙变闲的那一刻。参数是那条对话。 */
  readonly onIdle: (listener: (threadId: string) => void) => () => void
}
