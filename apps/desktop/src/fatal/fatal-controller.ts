import {
  type CreateFatalIncidentInput,
  createFatalIncident,
  type FatalIncident,
} from './fatal-incident'

export type FatalSnapshot =
  | {
      readonly status: 'healthy'
    }
  | {
      readonly status: 'fatal'
      readonly incident: FatalIncident
      readonly additionalIncidentCount: number
    }

export type FatalListener = () => void

export type FatalIncidentFactory = (input: CreateFatalIncidentInput) => FatalIncident

const HEALTHY_SNAPSHOT: FatalSnapshot = Object.freeze({
  status: 'healthy',
})

/**
 * Owns only the terminal fatal-incident state.
 *
 * Browser, React, Vite and native failure sources are adapted elsewhere.
 */
export class FatalIncidentController {
  private snapshot: FatalSnapshot = HEALTHY_SNAPSHOT

  private readonly listeners = new Set<FatalListener>()

  private readonly fingerprints = new Set<string>()

  private readonly createIncident: FatalIncidentFactory

  constructor(createIncident: FatalIncidentFactory = createFatalIncident) {
    this.createIncident = createIncident
  }

  readonly getSnapshot = (): FatalSnapshot => {
    return this.snapshot
  }

  readonly subscribe = (listener: FatalListener): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  report(input: CreateFatalIncidentInput): FatalIncident {
    const incident = this.createIncident(input)

    if (this.fingerprints.has(incident.fingerprint)) {
      if (this.snapshot.status === 'fatal') {
        return this.snapshot.incident
      }

      return incident
    }

    this.fingerprints.add(incident.fingerprint)

    if (this.snapshot.status === 'fatal') {
      this.snapshot = Object.freeze({
        status: 'fatal',
        incident: this.snapshot.incident,
        additionalIncidentCount: this.snapshot.additionalIncidentCount + 1,
      })

      this.emit()

      return this.snapshot.incident
    }

    this.snapshot = Object.freeze({
      status: 'fatal',
      incident,
      additionalIncidentCount: 0,
    })

    this.emit()

    return incident
  }

  private emit(): void {
    const listeners = [...this.listeners]

    for (const listener of listeners) {
      try {
        listener()
      } catch (error: unknown) {
        emergencyReportListenerFailure(error)
      }
    }
  }
}

function emergencyReportListenerFailure(error: unknown): void {
  try {
    console.error('[Hybrid Canvas] Fatal state listener failed', error)
  } catch {
    // No further fallback is safe.
  }
}
