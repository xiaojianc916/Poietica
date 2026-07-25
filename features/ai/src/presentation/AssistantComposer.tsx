import { Mic, Paperclip, Send, Sparkle } from 'lucide-react'
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

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly placeholder?: string
  readonly status?: 'ready' | 'submitted' | 'streaming' | 'error'
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
}

/**
 * Structure and behaviour come from AI Elements; visuals come from
 * assistant-composer.css. Deliberately no geometry classes inline.
 */
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
        const trimmed = (message.text ?? '').trim()

        if (trimmed.length === 0 && (message.files?.length ?? 0) === 0) {
          return
        }

        onSubmit({ text: trimmed, files: message.files ?? [] })
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
            <PromptInputActionMenuTrigger className="assistant-control--round">
              <Paperclip aria-hidden="true" />
            </PromptInputActionMenuTrigger>

            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments label="添加文件" />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          <PromptInputButton className="assistant-control--round" title="工具">
            <Sparkle aria-hidden="true" />
          </PromptInputButton>

          <PromptInputButton className="assistant-agent-pill">
            <Send aria-hidden="true" />

            <span>{agentLabel}</span>

            {isAgentNew ? <span className="assistant-agent-pill__badge">New</span> : null}
          </PromptInputButton>
        </PromptInputTools>

        <span className="assistant-toolbar__spacer" />

        <PromptInputButton className="assistant-control--ghost" title="语音输入">
          <Mic aria-hidden="true" />
        </PromptInputButton>

        <PromptInputSubmit disabled={text.trim().length === 0} status={status} />
      </PromptInputToolbar>
    </PromptInput>
  )
}
