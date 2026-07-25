'use client'

import { code } from '@streamdown/code'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { Streamdown } from 'streamdown'

import { cn } from './lib/utils'

/*
 * Replaces the upstream code-block, which binds directly to shiki. Highlighting
 * goes through the Streamdown pipeline the rest of the feed already uses, so
 * there is exactly one syntax highlighter in the application. The export surface
 * matches upstream, which is why tool.tsx needs no change.
 */

const plugins = { code }

const FENCE = String.fromCharCode(96).repeat(3)

export type CodeBlockProps = ComponentProps<'div'> & {
  code: string
  language?: string
  showLineNumbers?: boolean
}

export const CodeBlock = ({
  className,
  code: source,
  language = 'text',
  showLineNumbers: _showLineNumbers,
  children,
  ...props
}: CodeBlockProps) => (
  <div
    className={cn('not-prose w-full overflow-hidden rounded-md border text-xs', className)}
    data-language={language}
    {...props}
  >
    <Streamdown plugins={plugins}>{FENCE + language + '\n' + source + '\n' + FENCE}</Streamdown>
    {children}
  </div>
)

export type CodeBlockCopyButtonProps = ComponentProps<'button'> & {
  code?: string
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  children,
  className,
  code: source = '',
  onCopy,
  onError,
  timeout = 2000,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [copied, setCopied] = useState(false)

  return (
    <button
      className={cn('text-muted-foreground text-xs hover:text-foreground', className)}
      onClick={() => {
        navigator.clipboard
          .writeText(source)
          .then(() => {
            setCopied(true)
            onCopy?.()
            setTimeout(() => {
              setCopied(false)
            }, timeout)
          })
          .catch((error: unknown) => {
            onError?.(error instanceof Error ? error : new Error(String(error)))
          })
      }}
      type="button"
      {...props}
    >
      {children ?? (copied ? 'Copied' : 'Copy')}
    </button>
  )
}
