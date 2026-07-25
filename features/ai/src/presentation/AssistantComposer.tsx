import { useEffect, useId, useState } from 'react'
import type { MouseEvent } from 'react'

import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from './ai-elements/prompt-input'
import type { ChatStatus } from './ai-elements/prompt-input'
import { AgentIcon, AttachIcon, CheckIcon, MicIcon } from './primitives/icons'
import { MODEL_MARKS } from './primitives/model-icons'
import { useFluidResize } from './useFluidResize'
import type { AssistantModelDescriptor } from '../domain/model-catalog'

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly models: readonly AssistantModelDescriptor[]
  readonly modelId: string
  readonly onModelChange: (modelId: string) => void
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly columnId?: string
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
  columnId,
  onSubmit,
}: AssistantComposerProps) {
  const [text, setText] = useState('')

  const uid = useId()
  const cardId = `${uid}-card`
  const editorId = `${uid}-editor`

  const activeModel = models.find((model) => model.id === modelId) ?? models[0]
  const ActiveMark = MODEL_MARKS[activeModel.brand]

  useFluidResize(editorId, columnId)

  /* Ctrl/⌘+U is advertised in the menu, so it has to actually work. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'u') {
        return
      }

      const picker = document
        .getElementById(cardId)
        ?.querySelector<HTMLInputElement>('input[type="file"]')

      if (!picker) return

      event.preventDefault()
      picker.click()
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [cardId])

  const insertTrigger = (token: string) => {
    setText((current) =>
      current.length === 0 || current.endsWith(' ') ? `${current}${token}` : `${current} ${token}`,
    )

    document.getElementById(editorId)?.focus()
  }

  /* The card is the <form>: one box in the DOM, one box on screen. */
  const focusEditor = (event: MouseEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement

    if (target.closest('button, a, input, textarea, [role="option"], [role="menuitem"]')) {
      return
    }

    const editor = document.getElementById(editorId) as HTMLTextAreaElement | null

    if (!editor) return

    event.preventDefault()
    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }

  return (
    <PromptInput
      globalDrop
      id={cardId}
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
          id={editorId}
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
            <PromptInputActionMenuTrigger
              aria-label="添加内容"
              className="assistant-control--round"
            >
              <AttachIcon aria-hidden="true" />
            </PromptInputActionMenuTrigger>

            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments hint="Ctrl+U">
                图片与文件
              </PromptInputActionAddAttachments>

              <span className="assistant-action-menu__separator" role="separator" />

              <PromptInputActionMenuItem
                hint="/"
                onClick={() => {
                  insertTrigger('/')
                }}
              >
                命令
              </PromptInputActionMenuItem>

              <PromptInputActionMenuItem
                hint="@"
                onClick={() => {
                  insertTrigger('@')
                }}
              >
                上下文
              </PromptInputActionMenuItem>

              <PromptInputActionMenuItem
                hint="!"
                onClick={() => {
                  insertTrigger('!')
                }}
              >
                终端命令
              </PromptInputActionMenuItem>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          <PromptInputButton className="assistant-agent-pill">
            <AgentIcon aria-hidden="true" />

            <span>{agentLabel}</span>

            {isAgentNew ? <span className="assistant-agent-pill__badge">New</span> : null}
          </PromptInputButton>
        </PromptInputTools>

        <span className="assistant-toolbar__spacer" />

        <PromptInputModelSelect onValueChange={onModelChange} value={activeModel.id}>
          <PromptInputModelSelectTrigger>
            <ActiveMark className="assistant-model-select__brand" />

            <span>{activeModel.label}</span>
          </PromptInputModelSelectTrigger>

          <PromptInputModelSelectContent>
            {models.map((model) => {
              const Mark = MODEL_MARKS[model.brand]

              return (
                <PromptInputModelSelectItem key={model.id} value={model.id}>
                  <Mark className="assistant-model-select__brand" />

                  <span className="assistant-model-select__label">{model.label}</span>

                  <CheckIcon aria-hidden="true" className="assistant-model-select__check" />
                </PromptInputModelSelectItem>
              )
            })}
          </PromptInputModelSelectContent>
        </PromptInputModelSelect>

        <PromptInputButton aria-label="语音输入" className="assistant-control--ghost">
          <MicIcon aria-hidden="true" />
        </PromptInputButton>

        <PromptInputSubmit disabled={text.trim().length === 0} status={status} />
      </PromptInputToolbar>
    </PromptInput>
  )
}
