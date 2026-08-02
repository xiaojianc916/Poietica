import type { SVGProps } from 'react'

/**
 * 本地字形。
 *
 * 绘制在 16 网格上，描边 1 用户单位，水平与垂直线的坐标一律取 .5 —— 1 单位
 * 宽的描边以中心线为轴向两侧各扩 0.5，落在 .5 上时正好填满一整列像素，落在
 * 整数上则跨两列各半，那就是发虚。这是 codicon 与 Octicons 的绘制规则。
 *
 * 网格必须与渲染尺寸一致。此前这些字形是 24 网格（几何取自 Lucide，其官方
 * 规格为 24px / stroke 2）却渲染在 16px 上，描边实际宽度 2 × 16/24 = 1.333px，
 * 在任何缩放率下都不是整数设备像素。要多一档尺寸，正确做法是再画一套，不是
 * 缩放这一套。
 *
 * 描边宽度写死在字形内，不走 CSS 变量：它是几何的一部分，改了就不再对齐网格。
 */

type GlyphProps = SVGProps<SVGSVGElement>

/* 唯一的字形外框。className 等由调用方覆盖，所以 props 展开在后面。 */
function Glyph({ children, className, ...props }: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      fill="none"
      height={16}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1}
      viewBox="0 0 16 16"
      width={16}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  )
}

/** ai：星芒。 */
export function AiSurfaceIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6.75 1.75 8 5.5l3.75 1.25L8 8l-1.25 3.75L5.5 8 1.75 6.75 5.5 5.5Z" />
      <path d="M12.5 9.5v2.5" />
      <path d="M13.75 10.75h-2.5" />
    </Glyph>
  )
}

/** clock-10：表盘 + 指向十点的时针。 */
export function ClockTenIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l-2.75-1.5" />
    </Glyph>
  )
}

/** webhook：一个事件源分发到两个接收端。 */
export function WebhookIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="3.5" r="2" />
      <circle cx="3.5" cy="12.5" r="2" />
      <circle cx="12.5" cy="12.5" r="2" />
      <path d="M6.75 5.25 4.5 10.75" />
      <path d="m9.25 5.25 2.25 5.5" />
    </Glyph>
  )
}

/** lightbulb：灯泡。 */
export function LightbulbIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6.25 10.5c0-1.25-.5-1.75-1.1-2.4a4.25 4.25 0 1 1 5.7 0c-.6.65-1.1 1.15-1.1 2.4" />
      <path d="M6.25 12.5h3.5" />
      <path d="M7 14.5h2" />
    </Glyph>
  )
}
