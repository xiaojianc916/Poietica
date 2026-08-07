import type { ThreadAttachment, ThreadHistory } from '@poietica/acp'

/**
 * 转录那一侧，会话这一侧要用到的全部。
 *
 * 注入而不是 import 一个单例：实例由组合根造出来，测试因此塞得进一个假的，而
 * 「一个 store 订着一条线路」那道守卫也才是实例级而不是进程级的。窄到只剩这
 * 几句，是为了让那个假的写得出来。
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
   * 一张在飞表：同一个事实两处维护，迟早各说各的。输入框那一侧读的是同一格
   * （useAssistantSession 的 toChatStatus），所以这里读的也是已提交的那一份。
   *
   * 这是一个问句：它不折帧、不改状态，也不叫醒任何人。
   */
  readonly busy: (threadId: string) => boolean
  /** 某条对话从忙变闲的那一刻。参数是那条对话。 */
  readonly onIdle: (listener: (threadId: string) => void) => () => void
}
