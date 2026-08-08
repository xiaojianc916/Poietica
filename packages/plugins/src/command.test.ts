import { describe, expect, it } from 'vitest'

import { resolveCommands } from './command'

/* vercel-plugin 的 commands/deploy.md 就是这个形状。 */
const deploy = `---
description: Deploy the current project to Vercel. Pass "prod" as argument.
---

If "$ARGUMENTS" contains "prod", ask for confirmation.
`

describe('resolveCommands', () => {
  it('描述里的引号原样保留，$ARGUMENTS 被认出来', () => {
    const { commands } = resolveCommands('vercel-plugin', [
      { path: './commands/deploy.md', contents: deploy },
    ])

    expect(commands[0]?.name).toBe('deploy')
    expect(commands[0]?.invocation).toBe('/vercel-plugin:deploy')
    expect(commands[0]?.acceptsArguments).toBe(true)
    expect(commands[0]?.description).toContain('"prod"')
  })

  it('子目录里的 .md 一样成为命令，非 .md 忽略', () => {
    const { commands } = resolveCommands('demo', [
      { path: './commands/db/migrate.md', contents: '# migrate' },
      { path: './commands/notes.txt', contents: 'not a command' },
    ])

    expect(commands.map((command) => command.name)).toEqual(['migrate'])
    expect(commands[0]?.description).toBeUndefined()
    expect(commands[0]?.acceptsArguments).toBe(false)
  })

  it('重名只留第一条并记一条诊断', () => {
    const { commands, diagnostics } = resolveCommands('demo', [
      { path: './commands/deploy.md', contents: '# one' },
      { path: './commands/edge/deploy.md', contents: '# two' },
    ])

    expect(commands.map((command) => command.path)).toEqual(['./commands/deploy.md'])
    expect(diagnostics[0]?.code).toBe('name-taken')
  })
})
