import { describe, expect, it } from 'vitest'

import { booleanField, nameListField, parseFrontmatter, stringField } from './markdown'

/* kimi-datasource 的 SKILL.md 就是这个形状：description 是一段跨行的块标量。 */
const blockScalar = `---
name: kimi-datasource
description: |
  Universal data-source assistant. Use this skill when the user wants
  external structured data such as stocks and financial reports.
---

# kimi-datasource
`

describe('parseFrontmatter', () => {
  it('块标量跨行读全', () => {
    const document = parseFrontmatter(blockScalar)

    if (document.kind !== 'parsed') {
      throw new Error('期望解析成功')
    }

    expect(stringField(document.data, 'description')).toContain('external structured data')
    expect(document.body.trim()).toBe('# kimi-datasource')
  })

  it('值里的冒号与引号不被切坏', () => {
    const document = parseFrontmatter('---\ndescription: Deploy. Pass "prod" first.\n---\nx\n')

    if (document.kind !== 'parsed') {
      throw new Error('期望解析成功')
    }

    expect(stringField(document.data, 'description')).toBe('Deploy. Pass "prod" first.')
  })

  it('没有围栏、围栏没闭合都算没有 frontmatter', () => {
    expect(parseFrontmatter('# 标题\n').kind).toBe('absent')
    expect(parseFrontmatter('---\nname: x\n').kind).toBe('absent')
  })

  it('写坏的 YAML 是返回值不是异常', () => {
    expect(parseFrontmatter('---\na: [1,\n---\nbody\n').kind).toBe('malformed')
  })

  it('BOM 不影响围栏识别，空围栏是一组空键值', () => {
    expect(parseFrontmatter('\uFEFF---\n---\nbody\n').kind).toBe('parsed')
  })

  it('别名键三种写法都认，arguments 两种写法都收', () => {
    const data = { 'when-to-use': '写代码时', arguments: 'target mode' }

    expect(stringField(data, 'whenToUse', 'when-to-use', 'when_to_use')).toBe('写代码时')
    expect(nameListField(data, 'arguments')).toEqual(['target', 'mode'])
    expect(booleanField(data, 'disableModelInvocation')).toBe(false)
  })
})
