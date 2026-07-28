// poietica:proximity-fisheye@v3
// Tunable parameters for the conversation-minimap fisheye interaction.
// All distances are CSS pixels, measured from the padded bounding box of the rail.

export type ProximityFisheyeOptions = {
  /** Static fallback: distance at which magnification reaches 100%. */
  enterDistance: number
  /** Static fallback: distance at which magnification returns to 0%. */
  exitDistance: number
  /**
   * Element whose right edge starts the ramp (typically the conversation card).
   * When it resolves, the measured gap overrides enterDistance / exitDistance,
   * so the effect always begins exactly at the card border regardless of layout.
   * Set to null to disable anchoring and use the static distances above.
   */
  anchorSelector: string | null
  /** Fraction of the gap at which magnification is already at 100%. */
  anchorEnterRatio: number
  /** Guard rails for the measured gap, protecting against collapsed layouts. */
  anchorMinGap: number
  anchorMaxGap: number
  /** Extra hit area grown around the rail, per side (fallback when unanchored). */
  hitPadding: { top: number; right: number; bottom: number; left: number }
  /** Gaussian sigma in "number of items"; ~2 gives a soft neighbourhood falloff. */
  falloffItems: number
  /** Maximum horizontal scale for the item nearest the pointer. Keep this subtle. */
  maxScale: number
  /** Horizontal nudge in px applied at full weight; negative pulls items left. */
  maxShift: number
  /** Critically damped lerp factor per frame (0..1). Lower feels softer. */
  smoothing: number
  /** Weights below this collapse to 0 so the rAF loop can settle and stop. */
  epsilon: number
}

export const PROXIMITY_FISHEYE_DEFAULTS: ProximityFisheyeOptions = {
  enterDistance: 36,
  exitDistance: 120,
  anchorSelector: '[data-conversation-card]',
  anchorEnterRatio: 0.3,
  anchorMinGap: 48,
  anchorMaxGap: 420,
  hitPadding: { top: 10, right: 8, bottom: 10, left: 120 },
  falloffItems: 2,
  maxScale: 1.22,
  maxShift: -2,
  smoothing: 0.22,
  epsilon: 0.002,
}

export const PFE_ROOT_ATTR = 'data-pfe-root'
export const PFE_ACTIVE_ATTR = 'data-pfe-active'
export const PFE_ITEM_SELECTOR = '[data-pfe-item]'
export const PFE_WEIGHT_VAR = '--pfe-w'
