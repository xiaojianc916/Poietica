import { useState } from 'react'

import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from './ai-elements/prompt-input'
import type { ChatStatus } from './ai-elements/prompt-input'
import { AgentIcon, MicIcon, PaperclipIcon, ToolsIcon } from './primitives/icons'

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
}

export function AssistantComposer({
  agentLabel,
  isAgentNew = false,
  placeholder = '问我任何问题…',
  status = 'ready',
  onSubmit,
}: AssistantComposerProps) {
  const [text, setText] = useState('')

  return (
    <PromptInput
      globalDrop
      multiple
      onSubmit={(message) => {
        const trimmed = message.text.trim()

        if (trimmed.length === 0 && message.files.length === 0) {
          return
        }

        onSubmit({ text: trimmed, files: message.files })
        setText('')
      }}
    >
      <PromptInputBody>
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>

        <PromptInputTextarea
          onChange={(event) => {
            setText(event.currentTarget.value)
          }}
          placeholder={placeholder}
          value={text}
        />
      </PromptInputBody>

      <PromptInputToolbar>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger className="assistant-control--round" title="添加内容">
              <PaperclipIcon aria-hidden="true" />
            </PromptInputActionMenuTrigger>

            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments label="添加文件" />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          <PromptInputButton className="assistant-control--round" title="工具">
            <ToolsIcon aria-hidden="true" />
          </PromptInputButton>

          <PromptInputButton className="assistant-agent-pill">
            <AgentIcon aria-hidden="true" />

            <span>{agentLabel}</span>

            {isAgentNew ? <span className="assistant-agent-pill__badge">New</span> : null}
          </PromptInputButton>
        </PromptInputTools>

        <span className="assistant-toolbar__spacer" />

        <PromptInputButton className="assistant-control--ghost" title="语音输入">
          <MicIcon aria-hidden="true" />
        </PromptInputButton>

        <PromptInputSubmit disabled={text.trim().length === 0} status={status} />
      </PromptInputToolbar>
    </PromptInput>
  )
}
