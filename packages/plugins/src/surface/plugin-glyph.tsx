import { cn } from '@poietica/ui'

/**
 * 插件的图形标识。
 *
 * 这里画的不是「图标的占位」，而是唯一的形态 —— 那条数据链路里没有图标：
 * 上游 marketplace.json 每条只有 id / tier / displayName / version / description /
 * homepage / keywords / source；清单的 interface 块只有 displayName /
 * shortDescription / longDescription / developerName / websiteURL；两个官方插件
 * 的目录里也没有任何图片文件。所以不存在「加载失败回落到字母」这回事，也不该
 * 为一张不存在的图留 img 标签和加载态。
 *
 * 也不去网上取发布者头像：tauri.conf.json 的 img-src 只放行 self / data / blob
 * 与本地资源协议，远程图会被 webview 拦成碎图标；而把 img-src 放开到整个互联网，
 * 等于让目录里列出的任意主机拿到「这个用户打开了插件市场」这件事和他的 IP。
 */

const SIZES = {
  sm: 'size-8 rounded-lg text-[11px]',
  md: 'size-10 rounded-[10px] text-xs',
  lg: 'size-16 rounded-2xl text-lg',
} as const

export type PluginGlyphSize = keyof typeof SIZES

/*
 * 色相由 id 派生，不由显示名派生：显示名会随上游改文案而变，id 是插件在磁盘上
 * 的目录名，不变。颜色是人用来认「那个蓝的是它」的，跟着文案漂就白给了。
 */
export function pluginHue(id: string): number {
  let hash = 7

  for (const character of id) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 360
  }

  return hash
}

/* 取词首字母，最多两个：单字母区分度太低，四个官方条目里就会撞两次。 */
function initialsOf(displayName: string): string {
  const words = displayName.split(/[\s_-]+/u).filter((word) => word !== '')
  const initials = words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase()

  return initials === '' ? '?' : initials
}

export interface PluginGlyphProps {
  readonly displayName: string
  readonly id: string
  readonly size: PluginGlyphSize
}

export function PluginGlyph({ displayName, id, size }: PluginGlyphProps) {
  const hue = pluginHue(id)

  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center font-semibold', SIZES[size])}
      style={{ backgroundColor: `oklch(0.94 0.045 ${hue})`, color: `oklch(0.46 0.13 ${hue})` }}
    >
      {initialsOf(displayName)}
    </span>
  )
}
