import type { PermissionItem } from '@poietica/agent-timeline'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type AgentDialect, AgentDialectProvider } from '../domain/agent-dialect'
import { PermissionRequest } from '../PermissionRequest'

/*
 * 权限请求是唯一会把 agent 卡住、非等用户点一下不可的界面,因此它显示错字的
 * 代价比别处都高:用户是照着按钮上的字决定要不要放行的。
 *
 * 这里用 react-dom/server 而不是 testing-library:要守的两件事都只关乎一次
 * 渲染的产物(输出的文字、渲染时抛不抛),不需要 DOM,也就不需要为此往这个包
 * 里添三个依赖和一套环境配置。代价是点不了按钮,交互行为不在这批测试的射程内。
 */

/** 一家 agent 的说法。刻意让两枚选项同 kind、不同 name。 */
const DIALECT: AgentDialect = {
  optionLabels: {
    'Approve once': '批准一次',
    'Approve for this session': '本次会话都批准',
    Reject: '拒绝',
  },
  questions: [],
}

function permission(overrides: Partial<PermissionItem> = {}): PermissionItem {
  return {
    type: 'permission',
    id: 'r0-permission-1',
    at: 0,
    requestId: 'request-1',
    title: '写入文件',
    options: [
      { optionId: 'approve_once', name: 'Approve once', kind: 'allow_once' },
      { optionId: 'approve_always', name: 'Approve for this session', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
    ...overrides,
  }
}

function render(item: PermissionItem, dialect: AgentDialect = DIALECT): string {
  return renderToStaticMarkup(
    <AgentDialectProvider dialect={dialect}>
      <PermissionRequest item={item} onResolve={() => {}} />
    </AgentDialectProvider>,
  )
}

describe('权限请求', () => {
  it('没有 provider 就当场抛,不带着错文案画出来', () => {
    /*
     * 这正是应用崩掉的那一次:助手界面有两个入口,只有一个包了 provider。
     * 缺表时宁可炸在测试里,也不能悄悄套用另一家 agent 的说法。
     */
    expect(() =>
      renderToStaticMarkup(<PermissionRequest item={permission()} onResolve={() => {}} />),
    ).toThrow(/AgentDialectProvider is missing/)
  })

  it('同一个 kind 的两枚选项,显示的是各自的字', () => {
    /*
     * 按 kind 查表时这两枚都是 allow_once,会写着同一个词,用户无从分辨自己
     * 在批准哪一个。按 name 查表才分得开 —— name 是协议规定的 human-readable
     * label,是这枚选项自己说的话。
     */
    const markup = render(permission())

    expect(markup).toContain('批准一次')
    expect(markup).toContain('本次会话都批准')
    expect(markup).toContain('拒绝')
  })

  it('表里没有的说法,照 agent 原文显示', () => {
    /* 宁可显示英文,也不能显示一个错的中文。 */
    const markup = render(
      permission({
        options: [{ optionId: 'plan_revise', name: 'Revise', kind: 'reject_once' }],
      }),
    )

    expect(markup).toContain('Revise')
  })

  it('已经选过之后,回执上的字同样出自方言表', () => {
    /* 已决分支有它自己一条查表路径(labelOf),不测就没人看着。 */
    const markup = render(
      permission({ resolution: { optionId: 'approve_once', outcome: 'selected' } }),
    )

    expect(markup).toContain('已选择:批准一次')
    expect(markup).not.toContain('approve_once')
  })
})
