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
import { ProviderIcon } from './primitives/provider-icon'
import { useEditorGrowth } from './useEditorGrowth'

/*
 * The model is chosen through the agent, not around it.
 *
 * Under ACP the agent owns its model and its credentials, and Kimi already
 * ships the switch as a command of its own. So this control does not read the
 * agent config, does not keep a model list, and does not hold a state that
 * could disagree with the agent: it sends the command down the same path as
 * any other message, and the agent answers it in the transcript like anything
 * else it is asked. Nothing here can drift out of step, because nothing here
 * is remembered.
 */

/** The switch as the agent spells it. */
const MODEL_COMMAND = '/model'

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

          {/* A plain button on purpose: the submit path belongs to the form,
              and this asks the agent something instead of submitting what is
              being written, so it must not carry the editor content with it. */}
          <button
            aria-label="切换模型"
            className="assistant-control--ghost assistant-model-select"
            onClick={(event) => {
              event.preventDefault()
              onSubmit({ text: MODEL_COMMAND, files: [] })
            }}
            type="button"
          >
            <ProviderIcon />

            <span className="assistant-model-select__label">模型</span>
          </button>
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
