import type { AgentModel } from '../../contracts/model-contract'
import { ProviderIcon } from '../primitives/provider-icon'
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
} from './prompt-input'

/*
 * The model control of a graphical interface.
 *
 * A terminal offers a command; a window offers a list. Typing the command a
 * terminal would accept into a prompt sends the agent a MESSAGE, which is why
 * the agent rightly answered that it knows no such command — the earlier
 * version of this control was a category error, not a bug.
 *
 * So the choice is made here and carried out where the agent actually reads
 * it. Nothing is remembered locally: the list and the current entry are given,
 * and the only thing this control does is report which one was picked.
 */

export interface ModelSelectProps {
  readonly models: readonly AgentModel[]
  readonly activeModelId?: string | undefined
  readonly onSelect?: ((modelId: string) => void) | undefined
}

/*
 * The mark is given a provider only when there is one.
 *
 * Under exactOptionalPropertyTypes an optional property is absent rather
 * than undefined, so passing a possibly-undefined value is not the same as
 * passing nothing. The fallback mark is the component own business.
 */
function mark(provider?: string) {
  return provider === undefined ? <ProviderIcon /> : <ProviderIcon provider={provider} />
}

/*
 * What the control says when it has nothing to offer.
 *
 * Vanishing is the one thing it must not do. An absent control and an empty
 * list are indistinguishable once both render nothing, so a file that names
 * no model, a call that failed and a feature nobody connected all arrive as
 * the same silence. This label is the difference.
 */
const NOTHING_TO_OFFER = '模型未就绪'

export function ModelSelect({ models, activeModelId, onSelect }: ModelSelectProps) {
  const active = models.find((model) => model.id === activeModelId) ?? models[0]

  if (active === undefined) {
    return (
      <span
        aria-live="polite"
        className="assistant-model-select assistant-model-select__button"
        data-empty="true"
      >
        {mark()}

        <span className="assistant-model-select__label">{NOTHING_TO_OFFER}</span>
      </span>
    )
  }

  return (
    <PromptInputActionMenu className="assistant-model-select">
      <PromptInputActionMenuTrigger
        aria-label="切换模型"
        className="assistant-model-select__button"
      >
        {mark(active.provider)}

        <span className="assistant-model-select__label">{active.label}</span>
      </PromptInputActionMenuTrigger>

      <PromptInputActionMenuContent>
        {models.map((model) => (
          <PromptInputActionMenuItem
            key={model.id}
            onClick={() => {
              if (model.id === active.id) {
                return
              }
              onSelect?.(model.id)
            }}
          >
            <span className="assistant-model-option" data-active={model.id === active.id}>
              {mark(model.provider)}

              <span className="assistant-model-option__label">{model.label}</span>
            </span>
          </PromptInputActionMenuItem>
        ))}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  )
}
