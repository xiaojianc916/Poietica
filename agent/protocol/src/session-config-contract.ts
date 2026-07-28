/*
 * What the running session lets us change.
 *
 * The agent reports these when a session is created and reports them again
 * whenever one is changed, because changing one may add or remove another.
 * Nothing in this file names a model, a reasoning level or a mode: every
 * value on screen exists because the agent offered it.
 */

/** Where a selector belongs on screen. Mirrors the categories the protocol defines. */
export type SessionConfigPurpose = 'model' | 'thought' | 'mode' | 'other'

/** One value a selector will accept. */
export interface SessionConfigChoice {
  readonly value: string
  readonly label: string
  /** The explanation the agent gave, where it gave one. */
  readonly detail?: string | undefined
}

/** One selector the running session offers. */
export interface SessionConfigControl {
  readonly id: string
  readonly label: string
  readonly detail?: string | undefined
  readonly purpose: SessionConfigPurpose
  /** The value in force right now. */
  readonly current: string
  readonly choices: readonly SessionConfigChoice[]
}
