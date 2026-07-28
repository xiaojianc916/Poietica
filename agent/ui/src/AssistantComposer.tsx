import './composer/question-panel.css'

import type { ChatStatus, SessionConfigControl } from '@poietica/agent-protocol'
import type { RefObject } from 'react'
import type { PromptInputHandle } from './composer/prompt-input'
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
import { QuestionPanel } from './composer/question-panel'
import { SessionControls } from './composer/session-controls'
import type { QuestionAnswer, QuestionDeck } from './domain/ask-user-question'
import { MicIcon, PlusIcon } from './primitives/icons'

/*
 * The composer, declared rather than driven.
 *
 * It holds no state and runs no effect. The draft, the attachments, the focus
 * and the file picker all belong to PromptInput, which is the element they are
 * actually part of; reading them back out through the document was how two
 * owners of one textbox got away with it for as long as they did.
 */

export interface AssistantComposerProps {
  readonly placeholder?: string
  readonly status?: ChatStatus
  readonly onSubmit: (input: { readonly text: string; readonly files: readonly File[] }) => void
  readonly onCancel?: (() => void) | undefined
  /** How the surface writes a starter into the draft it does not own. */
  readonly handle?: RefObject<PromptInputHandle | null> | undefined
  /** Everything the session (or, before one exists, the agent config) offers. */
  readonly controls: readonly SessionConfigControl[]
  readonly controlsFailure?: string | undefined
  /** 读失败之后重新问一次。 */
  readonly onRetryControls?: (() => void) | undefined
  readonly onSelectControl: (controlId: string, value: string) => void
  /**
   * 待答的题组。
   *
   * 非空时输入框不再是输入框：它自己长成问答面板。空着就是平常那个 composer，
   * 所以这条 prop 不给也一切照旧。
   */
  readonly questionDeck?: QuestionDeck | null | undefined
  /** 面板交出整组答案（发送）或整组跳过（✕）时走这里。 */
  readonly onAnswerQuestions?: ((answers: readonly QuestionAnswer[]) => void) | undefined
}

function ComposerToolbar({
  controls,
  controlsFailure,
  onCancel,
  onRetryControls,
  onSelectControl,
  status,
}: Omit<AssistantComposerProps, 'onSubmit' | 'placeholder'> & { readonly status: ChatStatus }) {
  const { attachments, insertText, text } = usePromptInput()

  return (
    <PromptInputToolbar>
      <PromptInputTools>
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger aria-label="添加内容" className="assistant-control--ghost">
            <PlusIcon aria-hidden="true" />
          </PromptInputActionMenuTrigger>

          <PromptInputActionMenuContent>
            <AttachmentsItem />

            <PromptInputActionMenuItem hint="/" onClick={() => insertText('/')}>
              命令
            </PromptInputActionMenuItem>

            <PromptInputActionMenuItem hint="@" onClick={() => insertText('@')}>
              上下文
            </PromptInputActionMenuItem>

            <PromptInputActionMenuItem hint="!" onClick={() => insertText('!')}>
              终端命令
            </PromptInputActionMenuItem>
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>

        {/*
          会话设置属于左下这一簇，紧挨着 ＋。

          左下是「这一轮怎么发」，右下是「发」，两者不混：Zed 的 agent panel、
          Copilot Chat、Cursor 都是这个分工。此前它在麦克风左边，和发送挤在
          一起，而这一簇里站着一颗写死 agent 名字的药丸——不可点、改不了任何
          东西，占的正是模型选择器该在的位置。名字要由 agent 自己说，模型要
          能选，一个不可点的标签两件事都不做。
        */}
        <SessionControls
          controls={controls}
          failure={controlsFailure}
          onRetry={onRetryControls}
          onSelect={onSelectControl}
        />
      </PromptInputTools>

      <span className="assistant-toolbar__spacer" />

      <PromptInputButton aria-label="语音输入" className="assistant-control--ghost">
        <MicIcon aria-hidden="true" />
      </PromptInputButton>

      {/* The form accepts a submission carrying only attachments, so the
          button has to offer one: two readings of "is there anything to send"
          is how a dragged-in image ended up unsendable by mouse and sendable
          by Enter. */}
      <PromptInputSubmit
        disabled={status !== 'streaming' && text.trim().length === 0 && attachments.length === 0}
        onCancel={onCancel}
        status={status}
      />
    </PromptInputToolbar>
  )
}

function AttachmentsItem() {
  const { openFilePicker } = usePromptInput()

  return (
    <PromptInputActionMenuItem hint="Ctrl+U" onClick={openFilePicker}>
      图片与文件
    </PromptInputActionMenuItem>
  )
}

export function AssistantComposer({
  handle,
  onAnswerQuestions,
  placeholder = '问我任何问题…',
  questionDeck,
  status = 'ready',
  onSubmit,
  ...toolbar
}: AssistantComposerProps) {
  /*
   * 有题在等，输入框就不是输入框了。
   *
   * 换掉的只是壳里的内容：外面仍是同一个 PromptInput、同一个 form、同一层
   * assistant-prompt-input。所以这是输入框自己长成了面板，不是有个东西浮在
   * 它上面——后者会在滚动、聚焦和 Esc 上处处露馅。
   *
   * textarea 和工具栏一并让位。提问期间没有自由输入这回事：agent 那头等的是
   * 一个 optionId，不是一段话，留个能打字的框只会让人以为打了有用。
   */
  if (questionDeck != null && questionDeck.cards.length > 0) {
    return (
      <PromptInput className="assistant-prompt-input--question" handle={handle} onSubmit={onSubmit}>
        <QuestionPanel
          deck={questionDeck}
          onSkipAll={(answers) => {
            onAnswerQuestions?.(answers)
          }}
          onSubmit={(answers) => {
            onAnswerQuestions?.(answers)
          }}
        />
      </PromptInput>
    )
  }

  return (
    <PromptInput handle={handle} multiple onSubmit={onSubmit}>
      <PromptInputBody>
        <PromptInputAttachments />

        <PromptInputTextarea placeholder={placeholder} />
      </PromptInputBody>

      <ComposerToolbar status={status} {...toolbar} />
    </PromptInput>
  )
}
