/** Providers whose marks ship with the repository, in assets/provider-icons. */
export type AssistantModelBrand = 'deepseek' | 'zhipu' | 'kimi'

export interface AssistantModelDescriptor {
  readonly id: string
  readonly label: string
  readonly brand: AssistantModelBrand
}

/**
 * The default is a named constant rather than ASSISTANT_MODELS[0].
 *
 * Under `noUncheckedIndexedAccess` an index access is possibly undefined, so
 * building the catalog around this constant is what keeps the resolved model
 * non-nullable — no assertions, no casts, nothing hidden from the compiler.
 */
export const DEFAULT_ASSISTANT_MODEL: AssistantModelDescriptor = {
  id: 'deepseek-v3.2',
  label: 'DeepSeek V3.2',
  brand: 'deepseek',
}

export const ASSISTANT_MODELS: readonly AssistantModelDescriptor[] = [
  DEFAULT_ASSISTANT_MODEL,
  { id: 'glm-4.6', label: 'GLM-4.6', brand: 'zhipu' },
  { id: 'kimi-k2', label: 'Kimi K2', brand: 'kimi' },
]

export const DEFAULT_ASSISTANT_MODEL_ID = DEFAULT_ASSISTANT_MODEL.id

/** Always yields a model: an unknown id falls back to the default. */
export function resolveAssistantModel(
  models: readonly AssistantModelDescriptor[],
  id: string,
): AssistantModelDescriptor {
  return models.find((model) => model.id === id) ?? DEFAULT_ASSISTANT_MODEL
}
