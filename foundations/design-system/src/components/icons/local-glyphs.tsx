import type { SVGProps } from 'react'

/**
 * 本地字形。
 *
 * 这些不是 @mynaui/icons-react 里的图标，改这个文件不会影响图标库，升级图标库
 * 也不会影响这里——放在设计系统里只是因为工作区外壳和 AI 界面都要用，字形不该
 * 有两份。
 *
 * 几何取自 Lucide（ISC 许可），放进图标库的默认视口：width=24 height=24
 * fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"
 * 圆头圆角（见 mynaui-icons 仓库 icons/chevron-left.svg 原文）。描边而非实心，
 * 是因为实心字形无法与描边字形对齐视觉重量，也不随 currentColor 变化粗细。
 */

type GlyphProps = SVGProps<SVGSVGElement>

/*
 * 唯一的字形外框。属性表与图标库逐项一致，字形不各抄一遍；className 之类
 * 由调用方覆盖，所以 props 展开在后面。
 */
function Glyph({ children, ...props }: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={24}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      width={24}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  )
}

/** ai：星芒。图标库里没有这个字形，几何取自 Lucide 的 sparkles。 */
export function AiSurfaceIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </Glyph>
  )
}

/** clock-10：表盘 + 指向十点的时针。 */
export function ClockTenIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l-4-2" />
    </Glyph>
  )
}

/** pencil-ruler：铅笔与直角尺。 */
export function PencilRulerIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </Glyph>
  )
}

/** webhook：三条互相挂钩的回路。 */
export function WebhookIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
      <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
      <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
    </Glyph>
  )
}

/** lightbulb：灯泡。 */
export function LightbulbIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </Glyph>
  )
}
