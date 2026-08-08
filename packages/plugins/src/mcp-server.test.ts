import { describe, expect, it } from 'vitest'

import { type McpTransports, mcpServerWireOf, transportIsOffered } from './mcp-server'

/*
 * 夹具照抄上游原文，不改写：
 * MoonshotAI/kimi-code plugins/official/kimi-datasource/kimi.plugin.json 里的
 * mcpServers.data，以及 vercel/vercel-plugin .kimi-plugin/plugin.json 里的
 * mcpServers.vercel。官方文档 mcp.json 示例里的 filesystem / linear /
 * legacy-events 三条同理。
 */

describe('mcpServerWireOf', () => {
  it('官方插件那台 stdio 没有 transport 字段，照样认得出来', () => {
    expect(
      mcpServerWireOf('data', {
        command: 'node',
        args: ['./bin/kimi-datasource.mjs'],
        cwd: './',
      }),
    ).toEqual({ name: 'data', command: 'node', args: ['./bin/kimi-datasource.mjs'], env: [] })
  })

  it('只写了 url 的算 http', () => {
    expect(mcpServerWireOf('linear', { url: 'https://mcp.linear.app/mcp' })).toEqual({
      type: 'http',
      name: 'linear',
      url: 'https://mcp.linear.app/mcp',
    })
  })

  it('显式写 http 的与只写 url 的得到同一台', () => {
    expect(mcpServerWireOf('vercel', { transport: 'http', url: 'https://mcp.vercel.com' })).toEqual(
      mcpServerWireOf('vercel', { url: 'https://mcp.vercel.com' }),
    )
  })

  it('sse 要显式写出来，写了就留着', () => {
    expect(
      mcpServerWireOf('legacy-events', {
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
      }),
    ).toEqual({ type: 'sse', name: 'legacy-events', url: 'https://mcp.example.com/sse' })
  })

  it('env 摊平成协议要的那串键值对，args 缺省成空', () => {
    expect(mcpServerWireOf('filesystem', { command: 'npx', env: { TOKEN: 'x' } })).toEqual({
      name: 'filesystem',
      command: 'npx',
      args: [],
      env: [{ name: 'TOKEN', value: 'x' }],
    })
  })

  it('headers 原样带过去', () => {
    expect(
      mcpServerWireOf('gated', { url: 'https://example.com/mcp', headers: { A: 'b' } }),
    ).toEqual({ type: 'http', name: 'gated', url: 'https://example.com/mcp', headers: { A: 'b' } })
  })

  it('command 与 url 同时出现时，能真的起来的那一支说了算', () => {
    expect(mcpServerWireOf('both', { command: 'node', url: 'https://example.com/mcp' })).toEqual({
      name: 'both',
      command: 'node',
      args: [],
      env: [],
    })
  })

  it('两样都没有就是认不出，不猜', () => {
    expect(mcpServerWireOf('empty', { transport: 'http' })).toBeUndefined()
  })
})

describe('transportIsOffered', () => {
  const NEITHER: McpTransports = { http: false, sse: false }

  it('stdio 是基线，能力位说什么都送得出去', () => {
    const stdio = mcpServerWireOf('data', { command: 'node' })

    expect(stdio === undefined ? null : transportIsOffered(stdio, NEITHER)).toBe(true)
  })

  it('http 与 sse 各自看自己那一位', () => {
    const http = mcpServerWireOf('a', { url: 'https://example.com/mcp' })
    const sse = mcpServerWireOf('b', { transport: 'sse', url: 'https://example.com/sse' })
    const only = { http: true, sse: false }

    expect(http === undefined ? null : transportIsOffered(http, only)).toBe(true)
    expect(sse === undefined ? null : transportIsOffered(sse, only)).toBe(false)
  })
})
