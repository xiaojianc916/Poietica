import { describe, expect, it } from 'vitest'

import { resolveSkills } from './skill'

const directorySkill = `---
name: writing-plans
description: How to write an implementation plan
---

# Writing plans
`

describe('resolveSkills', () => {
  it('目录形式取 frontmatter 里的名字与描述', () => {
    const { skills, diagnostics } = resolveSkills('superpowers', './skills', [
      { path: './skills/writing-plans/SKILL.md', contents: directorySkill },
    ])

    expect(diagnostics).toEqual([])
    expect(skills[0]?.name).toBe('writing-plans')
    expect(skills[0]?.invocation).toBe('/skill:writing-plans')
    expect(skills[0]?.modelInvocable).toBe(true)
  })

  it('同名时目录形式压过扁平文件', () => {
    const { skills } = resolveSkills('demo', './skills', [
      { path: './skills/writing-plans.md', contents: '---\ndescription: 旧的\n---\n正文\n' },
      { path: './skills/writing-plans/SKILL.md', contents: directorySkill },
    ])

    expect(skills.map((skill) => skill.path)).toEqual(['./skills/writing-plans/SKILL.md'])
  })

  it('技能目录里的参考资料不是技能', () => {
    const { skills } = resolveSkills('demo', './skills', [
      { path: './skills/review-pr/SKILL.md', contents: directorySkill },
      { path: './skills/review-pr/references/checklist.md', contents: '# checklist' },
    ])

    expect(skills).toHaveLength(1)
  })

  it('省略 skills 时插件根上只有 SKILL.md 算技能', () => {
    const { skills } = resolveSkills('kimi-datasource', './', [
      { path: './SKILL.md', contents: directorySkill },
      { path: './README.md', contents: '# 说明\n' },
    ])

    expect(skills.map((skill) => skill.path)).toEqual(['./SKILL.md'])
  })

  it('目录形式缺 description 记一条诊断，而不是替它编一个', () => {
    const { skills, diagnostics } = resolveSkills('demo', './skills', [
      { path: './skills/broken/SKILL.md', contents: '---\nname: broken\n---\n\n正文\n' },
    ])

    expect(skills).toEqual([])
    expect(diagnostics[0]?.code).toBe('skill-incomplete')
  })

  it('扁平技能描述回落到正文第一行，flow 型模型不能自动挑起', () => {
    const { skills } = resolveSkills('demo', './skills', [
      { path: './skills/release.md', contents: '---\ntype: flow\n---\n\n手动触发的流程。\n' },
    ])

    expect(skills[0]?.name).toBe('release')
    expect(skills[0]?.description).toBe('手动触发的流程。')
    expect(skills[0]?.modelInvocable).toBe(false)
  })
})
