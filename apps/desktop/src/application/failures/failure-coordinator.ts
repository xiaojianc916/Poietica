import {
  createClassifiedFailure,
  createFailureScopeKey,
  isTerminalFailureImpact,
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  type FailureImpact,
  type FailureScope,
  type NonTerminalFailureImpact,
  type TerminalFailureImpact,
} from '@hybrid-canvas/foundations-kernel'
import {
  createFailureDiagnostic,
  normalizeFailureCause,
  sanitizeFailureContext,
  type FailureDiagnostic,
  type FailureDiagnosticHint,
} from './failure-diagnostic'

export interface FailureIncident extends ClassifiedFailure {
  readonly diagnostic: FailureDiagnostic
}

export type TerminalFailureIncident = FailureIncident & {
  readonly impact: TerminalFailureImpact
}

export type NonTerminalFailureIncident = FailureIncident & {
  readonly impact: NonTerminalFailureImpact
}

export interface PresentedFailure {
  readonly incident: NonTerminalFailureIncident

  readonly occurrences: number
}

export interface TerminalFailureState {
  readonly incident: TerminalFailureIncident

  readonly additionalIncidentCount: number
}

export interface FailureSnapshot {
  readonly terminal: TerminalFailureState | null

  readonly failures: readonly PresentedFailure[]

  readonly degradedFeatures: readonly string[]

  readonly quarantinedDocuments: readonly string[]
}

export interface FailureSignal extends Omit<ClassifiedFailureInput, 'technicalMessage'> {
  readonly technicalMessage?: string

  readonly diagnostic?: FailureDiagnosticHint
}

export type NonTerminalFailureInput = FailureSignal & {
  readonly impact: NonTerminalFailureImpact
}

export type TerminalFailureInput = FailureSignal & {
  readonly impact: TerminalFailureImpact
}

export type FailureListener = () => void

const EMPTY_SNAPSHOT: FailureSnapshot = Object.freeze({
  terminal: null,
  failures: Object.freeze([]),

  degradedFeatures: Object.freeze([]),

  quarantinedDocuments: Object.freeze([]),
})

const MAX_PRESENTED_FAILURES = 20

export class FailureCoordinator {
  private snapshot: FailureSnapshot = EMPTY_SNAPSHOT

  private readonly listeners = new Set<FailureListener>()

  private readonly degradedFeatures = new Set<string>()

  private readonly quarantinedDocuments = new Set<string>()

  private readonly terminalFingerprints = new Set<string>()

  readonly getSnapshot = (): FailureSnapshot => {
    return this.snapshot
  }

  readonly subscribe = (listener: FailureListener): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  report(signal: FailureSignal): FailureIncident {
    const incident = this.createIncident(signal)

    if (isTerminalFailureImpact(incident.impact)) {
      return this.reportTerminal(incident as TerminalFailureIncident)
    }

    return this.reportNonTerminal(incident as NonTerminalFailureIncident)
  }

  dismiss(incidentId: string): void {
    const failures = this.snapshot.incidents.filter((entry) => entry.incident.id !== incidentId)

    if (failures.length === this.snapshot.incidents.length) {
      return
    }

    this.publish({
      ...this.snapshot,
      failures,
    })
  }

  resolveScope(scope: FailureScope): void {
    const scopeKey = createFailureScopeKey(scope)

    if (scope.kind === 'feature') {
      this.degradedFeatures.delete(scope.featureId)
    }

    if (scope.kind === 'document') {
      this.quarantinedDocuments.delete(scope.documentId)
    }

    this.publish({
      ...this.snapshot,

      failures: this.snapshot.incidents.filter(
        (entry) => createFailureScopeKey(entry.incident.scope) !== scopeKey,
      ),

      degradedFeatures: [...this.degradedFeatures],

      quarantinedDocuments: [...this.quarantinedDocuments],
    })
  }

  private createIncident(signal: FailureSignal): FailureIncident {
    const normalized = normalizeFailureCause(signal.cause)

    const technicalMessage = signal.technicalMessage ?? normalized.message

    const context = sanitizeFailureContext(signal.context)

    const classified = createClassifiedFailure({
      impact: signal.impact,
      code: signal.code,
      userMessage: signal.userMessage,

      technicalMessage,
      scope: signal.scope,
      recovery: signal.recovery,

      ...optionalProperty('cause', signal.cause),

      context,
    })

    return Object.freeze({
      ...classified,

      diagnostic: createFailureDiagnostic(signal.cause, signal.diagnostic),
    })
  }

  private reportTerminal(incident: TerminalFailureIncident): TerminalFailureIncident {
    const current = this.snapshot.terminal

    if (this.terminalFingerprints.has(incident.fingerprint)) {
      return current?.incident ?? incident
    }

    this.terminalFingerprints.add(incident.fingerprint)

    if (current) {
      this.publish({
        ...this.snapshot,

        terminal: Object.freeze({
          incident: current.incident,

          additionalIncidentCount: current.additionalIncidentCount + 1,
        }),
      })

      return current.incident
    }

    this.publish({
      ...this.snapshot,

      terminal: Object.freeze({
        incident,
        additionalIncidentCount: 0,
      }),
    })

    return incident
  }

  private reportNonTerminal(incident: NonTerminalFailureIncident): NonTerminalFailureIncident {
    if (incident.impact === 'feature-degraded' && incident.scope.kind === 'feature') {
      this.degradedFeatures.add(incident.scope.featureId)
    }

    if (incident.impact === 'document-fatal' && incident.scope.kind === 'document') {
      this.quarantinedDocuments.add(incident.scope.documentId)
    }

    const existing = this.snapshot.incidents.find(
      (entry) => entry.incident.fingerprint === incident.fingerprint,
    )

    const retained = this.snapshot.incidents.filter(
      (entry) => entry.incident.fingerprint !== incident.fingerprint,
    )

    const presented: PresentedFailure = Object.freeze({
      incident,
      occurrences: (existing?.occurrences ?? 0) + 1,
    })

    this.publish({
      ...this.snapshot,

      failures: [...retained, presented].slice(-MAX_PRESENTED_FAILURES),

      degradedFeatures: [...this.degradedFeatures],

      quarantinedDocuments: [...this.quarantinedDocuments],
    })

    return incident
  }

  private publish(snapshot: FailureSnapshot): void {
    this.snapshot = Object.freeze({
      terminal: snapshot.terminal,

      failures: Object.freeze([...snapshot.incidents]),

      degradedFeatures: Object.freeze([...snapshot.degradedFeatures]),

      quarantinedDocuments: Object.freeze([...snapshot.quarantinedDocuments]),
    })

    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error: unknown) {
        try {
          console.error('[Hybrid Canvas] Failure coordinator listener failed', error)
        } catch {
          // No further safe fallback.
        }
      }
    }
  }
}

export const failureCoordinator = new FailureCoordinator()

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  if (value === undefined) {
    return {}
  }

  return {
    [key]: value,
  } as Record<Key, Value>
}
