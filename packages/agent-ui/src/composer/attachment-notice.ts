import type { AssistantSubmission } from '@poietica/agent-session'

/*
 * 附件说给 agent 听的那一句。
 *
 * 图片此刻还到不了 agent：一路上没有任何一层带得动它 —— transcript-store 的
 * send 只取 text，AgentPromptRequest 只有 threadId 与 text，原生侧的
 * Command::Prompt 亦然。而输入框的 onSubmit 只要求「文字与附件不能同时为空」，
 * 于是「只挑了一张图、没打字」送出去的是一个空 text，命令层判它参数无效，
 * 界面上就是那句 IpcInvocationError。
 *
 * 在字节真的能过去之前（那要 Command::Prompt 从 String 换成 ACP 的
 * ContentBlock 列表，再重新生成绑定），这里至少让这一句成立：带了什么、多大、
 * 什么类型，写进 prompt 里。人看得见，agent 也读得到，而不是一句「无效」。
 */

const KILOBYTE = 1024
const MEGABYTE = 1024 * 1024

const UNNAMED = '未命名附件'
const UNKNOWN_TYPE = '未知类型'

function sizeOf(bytes: number): string {
  if (bytes >= MEGABYTE) {
    return `${(bytes / MEGABYTE).toFixed(1)} MB`
  }

  if (bytes >= KILOBYTE) {
    return `${String(Math.round(bytes / KILOBYTE))} KB`
  }

  return `${String(bytes)} B`
}

function lineOf(file: File): string {
  const name = file.name.length > 0 ? file.name : UNNAMED
  const kind = file.type.length > 0 ? file.type : UNKNOWN_TYPE

  return `- ${name}（${kind}，${sizeOf(file.size)}）`
}

/**
 * 把附件折进 prompt 文本；没有附件就原样交回同一个对象。
 *
 * 原样交回很要紧：引用不变，下游的记忆化不会被这一层打掉。
 */
export function withAttachmentNotice(submission: AssistantSubmission): AssistantSubmission {
  if (submission.files.length === 0) {
    return submission
  }

  const text = submission.text.trim()
  const notice = ['[附件]', ...submission.files.map(lineOf)].join('\n')

  return { ...submission, text: text.length === 0 ? notice : `${text}\n\n${notice}` }
}
