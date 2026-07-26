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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from './composer/prompt-input'
import { ModelSelect } from './composer/model-select'
import type { ChatStatus } from '../contracts/chat-status-contract'
import type { AgentModel } from '../contracts/model-contract'
import { AgentIcon, MicIcon, PlusIcon } from './primitives/icons'
import { useEditorGrowth } from './useEditorGrowth'

/*
 * The model is offered as a list, because this is a window.
 *
 * The pinned ACP surface has no model API, so the choice is not a protocol
 * operation and cannot be sent down this connection at all; and the command a
 * terminal would accept is, through a prompt, merely a sentence addressed to
 * the agent. The composer therefore shows what it is given and reports what
 * was picked, and the work of making it true happens where the agent reads
 * its own configuration.
 *
 * With no list, there is no control: an empty picker would be a promise this
 * surface cannot keep.
 */

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
  /** Models the agent config declares. Absent while they are unknown. */
  readonly models?: readonly AgentModel[]
  readonly activeModelId?: string
  readonly onSelectModel?: (modelId: string) => void
}

export function AssistantComposer({
  agentLabel,
  isAgentNew = false,
  placeholder = '问我任何问题…',
  status = 'ready',
  onSubmit,
  models = [],
  activeModelId,
  onSelectModel,
}: AssistantComposerProps) {
  const [text, setText] = useState('')

  const uid = useId()
  const cardId = `${uid}-card`
  const editorId = `${uid}-editor`

  /*
   * The editor grows into its new height rather than jumping to it.
   *
   * The height itself stays a CSS fact; the hook only replays the previous box
   * onto the new one. What used to jolt was never the growth: it was a
   * counter-translate of the whole column, written for a centred layout that
   * spacers replaced, and a resize observer that fed its own animation back to
   * itself. Both are gone, so the growth can stay.
   */
  useEditorGrowth(editorId)

  /* Ctrl/⌘+U is advertised in the menu, so it has to actually work. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'u') return

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

    if (target.closest('button, a, input, textarea, [role="option"], [role="menuitem"]')) return

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

        if (trimmed.length === 0 && message.files.length === 0) return

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
              className="assistant-control--ghost"
            >
              <PlusIcon aria-hidden="true" />
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

          <ModelSelect activeModelId={activeModelId} models={models} onSelect={onSelectModel} />
        </PromptInputTools>

        <span className="assistant-toolbar__spacer" />

        <PromptInputButton aria-label="语音输入" className="assistant-control--ghost">
          <MicIcon aria-hidden="true" />
        </PromptInputButton>

        <PromptInputSubmit disabled={text.trim().length === 0} status={status} />
      </PromptInputToolbar>
    </PromptInput>
  )
}
