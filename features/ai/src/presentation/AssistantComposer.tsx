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
import type { ChatStatus } from '../contracts/chat-status-contract'
import { AgentIcon, MicIcon, PlusIcon } from './primitives/icons'
import { useFluidResize } from './useFluidResize'

/*
 * The composer no longer offers a model picker.
 *
 * Under ACP the agent owns its model: the client opens a session and prompts,
 * and which weights answer is decided on the other side of the connection. A
 * dropdown here could only ever have been decoration over a choice this process
 * does not make. The toolbar slot and its stylesheet are untouched, so the
 * things the agent really does advertise — its slash commands, which arrive as
 * an available_commands_update on the first frame of every session — can take
 * that place without a single change to the skin.
 */

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly columnId?: string
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
}

export function AssistantComposer({
  agentLabel,
  isAgentNew = false,
  placeholder = '问我任何问题…',
  status = 'ready',
  columnId,
  onSubmit,
}: AssistantComposerProps) {
  const [text, setText] = useState('')

  const uid = useId()
  const cardId = `${uid}-card`
  const editorId = `${uid}-editor`

  useFluidResize(editorId, columnId)

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
