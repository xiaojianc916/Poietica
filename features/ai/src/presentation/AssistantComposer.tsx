import { useState } from 'react'
import type { MouseEvent } from 'react'

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
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from './ai-elements/prompt-input'
import type { ChatStatus } from './ai-elements/prompt-input'
import { AgentIcon, AttachIcon, MicIcon, ModelIcon, ToolsIcon } from './primitives/icons'

export interface AssistantModelOption {
  readonly id: string
  readonly label: string
}

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly models: readonly AssistantModelOption[]
  readonly modelId: string
  readonly onModelChange: (modelId: string) => void
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
}

export function AssistantComposer({
  agentLabel,
  isAgentNew = false,
  models,
  modelId,
  onModelChange,
  placeholder = '问我任何问题…',
  status = 'ready',
  onSubmit,
}: AssistantComposerProps) {
  const [text, setText] = useState('')

  const activeModel = models.find((model) => model.id === modelId)?.label ?? modelId

  /*
   * The card is the <form> itself, so the click target and the visible border
   * are the same box. Presses that land on a control are left alone.
   */
  const focusEditor = (event: MouseEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement

    if (target.closest('button, a, input, textarea, [role="option"], [role="listbox"]')) {
      return
    }

    const editor = event.currentTarget.querySelector<HTMLTextAreaElement>(
      '[data-slot="prompt-input-textarea"]',
    )

    if (!editor) {
      return
    }

    event.preventDefault()
    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }

  return (
    <PromptInput
      globalDrop
      multiple
      onMouseDown={focusEditor}
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
              <AttachIcon aria-hidden="true" />
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

        <PromptInputModelSelect onValueChange={onModelChange} value={activeModel}>
          <PromptInputModelSelectTrigger>
            <ModelIcon aria-hidden="true" className="assistant-model-select__mark" />

            <PromptInputModelSelectValue />
          </PromptInputModelSelectTrigger>

          <PromptInputModelSelectContent>
            {models.map((model) => (
              <PromptInputModelSelectItem key={model.id} value={model.id}>
                {model.label}
              </PromptInputModelSelectItem>
            ))}
          </PromptInputModelSelectContent>
        </PromptInputModelSelect>

        <PromptInputButton className="assistant-control--ghost" title="语音输入">
          <MicIcon aria-hidden="true" />
        </PromptInputButton>

        <PromptInputSubmit disabled={text.trim().length === 0} status={status} />
      </PromptInputToolbar>
    </PromptInput>
  )
}
