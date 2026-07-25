/** Providers whose marks ship with the repository, in assets/provider-icons. */
export type AssistantModelBrand = 'deepseek' | 'zhipu' | 'kimi'

export interface AssistantModelDescriptor {
  readonly id: string
  readonly label: string
  readonly brand: AssistantModelBrand
}

export const ASSISTANT_MODELS: readonly AssistantModelDescriptor[] = [
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', brand: 'deepseek' },
  { id: 'glm-4.6', label: 'GLM-4.6', brand: 'zhipu' },
  { id: 'kimi-k2', label: 'Kimi K2', brand: 'kimi' },
]

export const DEFAULT_ASSISTANT_MODEL_ID = ASSISTANT_MODELS[0].id
