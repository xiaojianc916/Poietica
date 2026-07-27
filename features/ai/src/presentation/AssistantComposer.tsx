import type { ChatStatus } from '../contracts/chat-status-contract'
import type { SessionConfigControl } from '../contracts/session-config-contract'
import { SessionControls } from './composer/session-controls'
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  usePromptInput,
} from './composer/prompt-input'
import { AgentIcon, MicIcon, PlusIcon } from './primitives/icons'

/*
 * The composer, declared rather than driven.
 *
 * It holds no state and runs no effect. The draft, the attachments, the focus
 * and the file picker all belong to PromptInput, which is the element they are
 * actually part of; reading them back out through the document was how two
 * owners of one textbox got away with it for as long as they did.
 */

export interface AssistantComposerProps {
  readonly agentLabel: string
  readonly isAgentNew?: boolean
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
  readonly onCancel?: () => void
  /** Everything the session (or, before one exists, the agent config) offers. */
  readonly controls: readonly SessionConfigControl[]
  readonly controlsFailure?: string | undefined
  readonly onSelectControl: (controlId: string, value: string) => void
}

function ComposerToolbar({
  agentLabel,
  controls,
  controlsFailure,
  isAgentNew,
  onCancel,
  onSelectControl,
  status,
}: Omit<AssistantComposerProps, 'onSubmit' | 'placeholder'> & { readonly status: ChatStatus }) {
  const { insertText, text } = usePromptInput()

  return (
    <PromptInputToolbar>
      <PromptInputTools>
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger aria-label="添加内容" className="assistant-control--ghost">
            <PlusIcon aria-hidden="true" />
          </PromptInputActionMenuTrigger>

          <PromptInputActionMenuContent>
            <AttachmentsItem />

            <PromptInputActionMenuItem hint="/" onSelect={() => insertText('/')}>
              命令
            </PromptInputActionMenuItem>

            <PromptInputActionMenuItem hint="@" onSelect={() => insertText('@')}>
              上下文
            </PromptInputActionMenuItem>

            <PromptInputActionMenuItem hint="!" onSelect={() => insertText('!')}>
              终端命令
            </PromptInputActionMenuItem>
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>

        <PromptInputButton className="assistant-agent-pill">
          <AgentIcon aria-hidden="true" />

          <span>{agentLabel}</span>

          {isAgentNew === true ? <span className="assistant-agent-pill__badge">New</span> : null}
        </PromptInputButton>
      </PromptInputTools>

      <span className="assistant-toolbar__spacer" />

      <SessionControls controls={controls} failure={controlsFailure} onSelect={onSelectControl} />

      <PromptInputButton aria-label="语音输入" className="assistant-control--ghost">
        <MicIcon aria-hidden="true" />
      </PromptInputButton>

      <PromptInputSubmit
        disabled={status !== 'streaming' && text.trim().length === 0}
        status={status}
        {...(onCancel === undefined ? {} : { onCancel })}
      />
    </PromptInputToolbar>
  )
}

function AttachmentsItem() {
  const { openFilePicker } = usePromptInput()

  return (
    <PromptInputActionMenuItem hint="Ctrl+U" onSelect={openFilePicker}>
      图片与文件
    </PromptInputActionMenuItem>
  )
}

export function AssistantComposer({
  placeholder = '问我任何问题…',
  status = 'ready',
  onSubmit,
  ...toolbar
}: AssistantComposerProps) {
  return (
    <PromptInput multiple onSubmit={onSubmit}>
      <PromptInputBody>
        <PromptInputAttachments />

        <PromptInputTextarea placeholder={placeholder} />
      </PromptInputBody>

      <ComposerToolbar status={status} {...toolbar} />
    </PromptInput>
  )
}
