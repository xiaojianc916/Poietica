// poietica:proximity-fisheye@v2
// Tunable parameters for the conversation-minimap fisheye interaction.
// All distances are CSS pixels, measured from the padded bounding box of the rail.

export type ProximityFisheyeOptions = {
  /** Distance at which magnification reaches 100%. */
  enterDistance: number
  /** Distance at which magnification returns to 0%. Must exceed enterDistance. */
  exitDistance: number
  /** Extra hit area grown around the rail, per side. */
  hitPadding: { top: number; right: number; bottom: number; left: number }
  /** Gaussian sigma in "number of items"; ~2 reproduces the macOS Dock falloff. */
  falloffItems: number
  /** Maximum horizontal scale for the item nearest the pointer. */
  maxScale: number
  /** Horizontal nudge in px applied at full weight; negative pulls items left. */
  maxShift: number
  /** Critically damped lerp factor per frame (0..1). Lower feels softer. */
  smoothing: number
  /** Weights below this collapse to 0 so the rAF loop can settle and stop. */
  epsilon: number
}

export const PROXIMITY_FISHEYE_DEFAULTS: ProximityFisheyeOptions = {
  enterDistance: 24,
  exitDistance: 48,
  hitPadding: { top: 10, right: 8, bottom: 10, left: 28 },
  falloffItems: 2,
  maxScale: 1.75,
  maxShift: -6,
  smoothing: 0.22,
  epsilon: 0.002,
}

export const PFE_ROOT_ATTR = 'data-pfe-root'
export const PFE_ACTIVE_ATTR = 'data-pfe-active'
export const PFE_ITEM_SELECTOR = '[data-pfe-item]'
export const PFE_WEIGHT_VAR = '--pfe-w'
