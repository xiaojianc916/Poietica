import type { ComponentPropsWithoutRef } from 'react'

/**
 * 一张有框的面。
 *
 * 外观全部在 design-system 的 [data-surface] 里，这里只负责让那个属性无法
 * 缺席：它写在展开之后，所以调用方既不能漏写也不能覆盖掉。此前这件事是
 * 手写 className="assistant-card …"，三个消费点各写一次，漏了不报错 ——
 * 那正是同一种卡片在界面上出现两种边框的原因。
 *
 * 标签只开放 div 与 section，因为这条流里只有这两种语义；写成联合而不是
 * 泛型 as，是为了不引入任何 ElementType 断言。
 */
export type SurfaceProps = ComponentPropsWithoutRef<'div'> & {
  readonly as?: 'div' | 'section'
}

export function Surface({ as = 'div', ...rest }: SurfaceProps) {
  return as === 'section' ? (
    <section {...rest} data-surface="" />
  ) : (
    <div {...rest} data-surface="" />
  )
}
