import './composer/composer-actions.css'
import './composer/question-panel.css'

import type { ChatStatus, SessionConfigControl } from '@poietica/acp'
import { memo, type RefObject } from 'react'
import { ComposerActions } from './composer/composer-actions'
import type { PromptInputHandle } from './composer/prompt-input'
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  usePromptInputDraft,
} from './composer/prompt-input'
import { QuestionPanel } from './composer/question-panel'
import { SessionControls } from './composer/session-controls'
import type { QuestionAnswer, QuestionDeck } from './domain/ask-user-question'
import { MicIcon } from './primitives/icons'

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
  /*
   * 发送键只问一件事：有没有东西可发。
   *
   * 它此前是从整串草稿里现算 text.trim().length === 0 得出的，代价是这一层
   * 连同两个菜单根随每个字符重渲一次。判据挪到了 PromptInput 里，这里拿到的
   * 是两个布尔，只在空与非空之间翻转时才换引用。
   */
  const { hasFiles, hasText } = usePromptInputDraft()

  return (
    <PromptInputToolbar>
      <PromptInputTools>
        {/*
          左下这一簇回答两个问题:往这一句里加什么,以及这一句怎么被处理。
          模式因此在这里,不在发送键那一侧 —— 那一侧回答的是"谁来答"。

          此前这里还有「命令」「上下文」「终端命令」三行,它们的实现是往草稿
          末尾拼一个字符(insertText)。那不是命令面板,那是替用户按了一下键,
          而菜单里一条读起来像功能的行必须真的是功能。
        */}
        <ComposerActions controls={controls} onSelectControl={onSelectControl} />
      </PromptInputTools>

      <span className="assistant-toolbar__spacer" />

      {/*
        模型选择器站在右下这一簇，麦克风之前。

        它挨着「发」，因为它说的正是这一句将被谁回答：ChatGPT、Claude、Cursor
        都把它放在发送键这一侧。左下那一簇回答的是另一个问题——往这句话里加
        什么。
      */}
      <SessionControls
        controls={controls}
        failure={controlsFailure}
        onRetry={onRetryControls}
        onSelect={onSelectControl}
      />

      <PromptInputButton aria-label="语音输入" className="assistant-control--ghost">
        <MicIcon aria-hidden="true" />
      </PromptInputButton>

      {/* The form accepts a submission carrying only attachments, so the
          button has to offer one: two readings of "is there anything to send"
          is how a dragged-in image ended up unsendable by mouse and sendable
          by Enter. */}
      <PromptInputSubmit
        disabled={status !== 'streaming' && !hasText && !hasFiles}
        onCancel={onCancel}
        status={status}
      />
    </PromptInputToolbar>
  )
}

/*
 * 记住不重建。
 *
 * 它此前长在 AssistantSurface 的渲染体里，而那一层订着整条转录：模型每吐一个
 * 字，PromptInput 连同草稿、附件、模型选择器与发送键整棵树 reconcile 一次 ——
 * 一棵与转录内容毫无关系的树。上游的订阅粒度已经收窄，入参也全部引用稳定，
 * 这一层浅比较因此几乎总是命中：一轮对话里它至多重渲两次。
 */
export const AssistantComposer = memo(function AssistantComposer({
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
    <PromptInput accept="image/*" handle={handle} multiple onSubmit={onSubmit}>
      <PromptInputBody>
        <PromptInputAttachments />

        <PromptInputTextarea placeholder={placeholder} />
      </PromptInputBody>

      <ComposerToolbar status={status} {...toolbar} />
    </PromptInput>
  )
})
