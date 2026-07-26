import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { memo } from 'react'
import { Streamdown } from 'streamdown'

/*
 * The single markdown entry point for the agent feed. Everything that renders
 * model output goes through here, which keeps plugin configuration in one place
 * instead of spread across surfaces.
 *
 * URL POLICY IS CURRENTLY THE RENDERER'S DEFAULT, WHICH IS "ALLOW EVERYTHING".
 *
 * This file used to pass allowedLinkPrefixes and allowedImagePrefixes. Those
 * are no longer props: the installed renderer moved that policy into its
 * rehype-harden plugin entry, which can only be re-configured by passing a
 * rehypePlugins array built from the harden plugin itself. That means taking a
 * direct dependency on rehype-harden, which is a decision to make deliberately
 * rather than inside a refactor — so the props were removed and nothing was
 * quietly substituted for them. Agent output is not trusted input; restore the
 * policy before this surface renders anything from a real session.
 */

const plugins = { cjk, code, math, mermaid }

export type AgentMarkdownProps = {
  children: string
  isStreaming?: boolean
}

export const AgentMarkdown = memo(({ children, isStreaming = false }: AgentMarkdownProps) => (
  <Streamdown parseIncompleteMarkdown={isStreaming} plugins={plugins}>
    {children}
  </Streamdown>
))

AgentMarkdown.displayName = 'AgentMarkdown'
