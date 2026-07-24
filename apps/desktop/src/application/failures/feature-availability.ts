export const DEGRADABLE_FEATURE_IDS = [
  'settings',
  'developer-tools',
  'window-controls',
  'window-dragging',
  'window-state-sync',
  'window-close-coordination',
] as const

export type DegradableFeatureId = (typeof DEGRADABLE_FEATURE_IDS)[number]

export interface FeatureAvailability {
  readonly degradedFeatures: ReadonlySet<string>

  readonly isAvailable: (featureId: DegradableFeatureId) => boolean
}

export function createFeatureAvailability(
  degradedFeatureIds: readonly string[],
): FeatureAvailability {
  const degradedFeatures = new Set(degradedFeatureIds)

  return Object.freeze({
    degradedFeatures,

    isAvailable(featureId: DegradableFeatureId): boolean {
      return !degradedFeatures.has(featureId)
    },
  })
}
