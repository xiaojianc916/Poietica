import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { memo } from 'react'
import { Streamdown } from 'streamdown'

/*
 * The single markdown entry point for the agent feed. Everything that renders
 * model output goes through here, which keeps plugin configuration and link
 * policy in one place instead of spread across surfaces.
 */

const plugins = { cjk, code, math, mermaid }

const ALLOWED_LINK_PREFIXES = ['https://', 'http://localhost', 'file://']
const ALLOWED_IMAGE_PREFIXES = ['https://']

export type AgentMarkdownProps = {
  children: string
  isStreaming?: boolean
}

export const AgentMarkdown = memo(({ children, isStreaming = false }: AgentMarkdownProps) => (
  <Streamdown
    allowedImagePrefixes={ALLOWED_IMAGE_PREFIXES}
    allowedLinkPrefixes={ALLOWED_LINK_PREFIXES}
    parseIncompleteMarkdown={isStreaming}
    plugins={plugins}
  >
    {children}
  </Streamdown>
))

AgentMarkdown.displayName = 'AgentMarkdown'
