import type { SessionConfigControl } from './config'

/*
 * 这个 agent 提供哪些可调项：模型、模式、推理档位，一张表。
 *
 * 这个端口不认识 threadId —— 不是省略，是它问不出那种问题。能力属于 agent，
 * 某条会话此刻真在用什么才属于那条会话（见 SessionConfigPort）。入口那一格既没有
 * 对话也没有会话，而选择器在那里必须画得出来：ChatGPT / Claude / Cursor / VS Code
 * Copilot Chat 的新会话界面模型与模式选择器一直都在。
 *
 * read 与 select 交回同一张表，理由与 SessionConfigPort 逐字相同：改一项可能增删
 * 另一项。模型也在这张表里，所以换模型与换档位是同一次往返的两个参数，而不是两条
 * 各自落地的路径 —— 档位的取值空间由模型决定，分两条走就必然有一刻屏幕上的档位
 * 属于上一个模型。
 */

export interface AgentCapabilityPort {
  /** 这个 agent 提供的整张选择器表。 */
  readonly read: () => Promise<readonly SessionConfigControl[]>
  /**
   * 把这一项改成这个值，交回改完之后的整张表。
   *
   * 收整个 control 而不只是它的 id：认出"模型那一格"靠的是 purpose，而 id 是 agent
   * 自己起的名字，协议没有规定过。
   */
  readonly select: (
    control: SessionConfigControl,
    value: string,
  ) => Promise<readonly SessionConfigControl[]>
}
