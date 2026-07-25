import type {
  TLAnyBindingUtilConstructor,
  TLAnyShapeUtilConstructor,
  TLStateNodeConstructor,
} from 'tldraw'

export const POIETICA_EXTENSION_API_VERSION = '3'

export interface PoieticaExtension {
  readonly id: string
  readonly version: string
  readonly apiVersion: string
  readonly shapeUtils?: readonly TLAnyShapeUtilConstructor[]
  readonly bindingUtils?: readonly TLAnyBindingUtilConstructor[]
  readonly tools?: readonly TLStateNodeConstructor[]
  readonly shapeLabels?: Readonly<Record<string, string>>
}

export interface ExtensionRegistration {
  readonly extensions: readonly PoieticaExtension[]
  readonly shapeUtils: readonly TLAnyShapeUtilConstructor[]
  readonly bindingUtils: readonly TLAnyBindingUtilConstructor[]
  readonly tools: readonly TLStateNodeConstructor[]
  readonly shapeLabels: Readonly<Record<string, string>>
}

export function buildExtensionRegistration(
  input: readonly PoieticaExtension[] = [],
): ExtensionRegistration {
  const ids = new Set<string>()
  const shapeUtils: TLAnyShapeUtilConstructor[] = []
  const bindingUtils: TLAnyBindingUtilConstructor[] = []
  const tools: TLStateNodeConstructor[] = []
  const shapeLabels: Record<string, string> = {}

  for (const extension of input) {
    if (!extension.id || ids.has(extension.id)) {
      throw new Error('EXTENSION_DUPLICATE_ID')
    }

    if (extension.apiVersion !== POIETICA_EXTENSION_API_VERSION) {
      throw new Error('EXTENSION_API_VERSION_MISMATCH')
    }

    ids.add(extension.id)

    shapeUtils.push(...(extension.shapeUtils ?? []))

    bindingUtils.push(...(extension.bindingUtils ?? []))

    tools.push(...(extension.tools ?? []))

    Object.assign(shapeLabels, extension.shapeLabels)
  }

  return Object.freeze({
    extensions: Object.freeze([...input]),

    shapeUtils: Object.freeze(shapeUtils),

    bindingUtils: Object.freeze(bindingUtils),

    tools: Object.freeze(tools),

    shapeLabels: Object.freeze(shapeLabels),
  })
}
