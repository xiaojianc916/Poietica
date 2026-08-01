import type { PermissionItem } from '@poietica/agent-timeline'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentDialectProvider } from '../domain/AgentDialectProvider'
import type { AgentDialect } from '../domain/agent-dialect'
import { PermissionRequest } from '../PermissionRequest'

/*
 * 提问闸门。
 *
 * ACP 没有「提问」这个概念，一道题在 wire 上就是一个 session/request_permission。
 * 于是 PermissionRequest 要当场判断：这一帧该画成一道题，还是画成一次授权。
 * 判错的方向不对称 —— 把授权误判成提问，用户以为自己在挑选项，实际是在批准
 * 写盘。ask-user-question.ts 的注释写明了这个风险，这个文件负责守住它。
 *
 * 方言在这里就地写死，不从 packages/agent-registry 取：界面层不认识任何一家 agent，
 * 测试也不该反过来把这条依赖引进来。它只需要一份形状对的方言。
 */

const DIALECT: AgentDialect = {
  optionLabels: { Skip: '跳过' },
  questions: [{ option: /^q(\d+)_opt_(\d+)$/, skip: /^q(\d+)_skip$/ }],
}

/**
 * 一道题。
 *
 * title 写死成工具名是上游的实际发法，题面在 toolCall.content 里 —— 这不是
 * 夹具偷懒，是 wire 上就长这样，QuestionOutcome 的取值路径正因此而存在。
 */
function question(resolution?: PermissionItem['resolution']): PermissionItem {
  return {
    type: 'permission',
    id: 'item-question',
    at: 0,
    requestId: 'req-question',
    title: 'AskUserQuestion',
    toolCall: {
      toolCallId: '0:ask_0',
      content: [{ type: 'content', content: { type: 'text', text: '这一版用哪种配色？' } }],
    },
    options: [
      { optionId: 'q0_opt_0', name: '深色', kind: 'allow_once' },
      { optionId: 'q0_opt_1', name: '浅色', kind: 'allow_once' },
      { optionId: 'q0_skip', name: 'Skip', kind: 'reject_once' },
    ],
    ...(resolution === undefined ? {} : { resolution }),
  }
}

/**
 * 一次授权，optionId 却恰好落在提问的命名空间里。
 *
 * 这是闸门唯一真正危险的输入：形状全对，只有 kind 出卖了它 —— 一道题里不会
 * 出现 allow_always，因为「以后都这么答」对提问没有意义。
 */
function consent(): PermissionItem {
  return {
    type: 'permission',
    id: 'item-consent',
    at: 0,
    requestId: 'req-consent',
    title: '写入文件',
    options: [
      { optionId: 'q0_opt_0', name: '写入', kind: 'allow_once' },
      { optionId: 'q0_opt_1', name: '始终写入', kind: 'allow_always' },
    ],
  }
}

function render(item: PermissionItem): string {
  return renderToStaticMarkup(
    <AgentDialectProvider dialect={DIALECT}>
      <PermissionRequest item={item} onResolve={() => {}} />
    </AgentDialectProvider>,
  )
}

describe('提问闸门', () => {
  it('形状与 kind 都对得上,画成一道题而不是一排授权按钮', () => {
    const markup = render(question())

    expect(markup).toContain('assistant-outcome')
    expect(markup).not.toContain('assistant-permission__options')
    expect(markup).toContain('等待回答…')
  })

  it('形状对但 kind 是长期授权的,仍旧当授权处理', () => {
    const markup = render(consent())

    expect(markup).not.toContain('assistant-outcome')
    expect(markup).toContain('assistant-permission__options')
    expect(markup).toContain('始终写入')
  })

  it('题面取自 toolCall 里的那段文本,不是写死的工具名', () => {
    const markup = render(question())

    expect(markup).toContain('这一版用哪种配色？')
    expect(markup).not.toContain('AskUserQuestion')
  })

  it('答过之后只留被选中的那一个,落选项不再露面', () => {
    const markup = render(question({ optionId: 'q0_opt_1', outcome: 'selected' }))

    expect(markup).toContain('assistant-outcome__answer')
    expect(markup).toContain('浅色')
    expect(markup).not.toContain('深色')
  })

  it('跳过不算答案,底下一句话交代', () => {
    const markup = render(question({ optionId: 'q0_skip', outcome: 'selected' }))

    expect(markup).not.toContain('assistant-outcome__answer')
    expect(markup).toContain('已跳过，未回答')
    expect(markup).not.toContain('Skip')
  })
})
