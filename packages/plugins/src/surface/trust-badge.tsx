import { cn } from '@poietica/ui'

import type { PluginTrustTier } from '../install-source'

/*
 * 信任档位是唯一决定「安装要不要人点头」的东西（requiresInstallConfirmation），
 * 所以它在列表里就要看得见，而不是等到确认那一刻才第一次出现。
 */

const LABELS: Record<PluginTrustTier, string> = {
  'kimi-official': '官方',
  curated: '精选',
  'third-party': '第三方',
}

export interface TrustBadgeProps {
  readonly trust: PluginTrustTier
}

export function TrustBadge({ trust }: TrustBadgeProps) {
  return (
    <span
      className={cn(
        'shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]',
        trust === 'kimi-official' ? 'font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      {LABELS[trust]}
    </span>
  )
}
