import { useCallback, useEffect, useRef, useState } from 'react'

import { CheckIcon, FailureIcon } from '../primitives/icons'

/**
 * 一次失败的运行，在它停下来的地方说一句。
 *
 * 它是一条线而不是一块卡片：报错原文属于排查现场，不属于阅读现场 —— 真正需要
 * 它的时刻，人要的是"整段拿走"，而不是"在流里反复读它"。所以中间这行是摘要，
 * 超出一行就截断，完整原文只交给剪贴板 —— 原生 tooltip 会按原文长度铺开，盖住的
 * 恰好是你要对照的那条流，所以这里不挂 title。
 *
 * 复制失败不切对勾。一个假的成功反馈比没有反馈更贵：人会以为原文已经在手上，
 * 于是把这条报错关掉。
 */

/** 对勾停留的时间。够看清，又短于一次"我再复制一遍"的犹豫。 */
const RESTORE_MS = 2200

export interface ErrorNoticeProps {
  readonly message: string
}

export function ErrorNotice({ message }: ErrorNoticeProps) {
  const [copied, setCopied] = useState(false)
  const restore = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /* 卸载时收掉定时器：报错常在重试后立刻从流里消失。 */
  useEffect(
    () => () => {
      clearTimeout(restore.current)
    },
    [],
  )

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message)
    } catch {
      return
    }

    clearTimeout(restore.current)
    setCopied(true)
    restore.current = setTimeout(() => setCopied(false), RESTORE_MS)
  }, [message])

  const Glyph = copied ? CheckIcon : FailureIcon

  return (
    <div className="timeline-error" data-copied={copied ? 'true' : undefined} role="alert">
      <button
        aria-label={copied ? '报错信息已复制' : '复制完整报错信息'}
        className="timeline-error__action"
        onClick={() => {
          void copy()
        }}
        type="button"
      >
        <Glyph aria-hidden="true" className="timeline-error__mark" />
        <span className="timeline-error__text">{message}</span>
      </button>
    </div>
  )
}
