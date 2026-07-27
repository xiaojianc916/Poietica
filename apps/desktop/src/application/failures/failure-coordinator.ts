import {
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  createClassifiedFailure,
  createFailureScopeKey,
  type FailureScope,
  isTerminalFailureImpact,
  type NonTerminalFailureImpact,
  type TerminalFailureImpact,
} from '@poietica/foundations-kernel'
import { error as reportDiagnosticError } from '@poietica/foundations-observability'
import {
  createFailureDiagnostic,
  type FailureDiagnostic,
  type FailureDiagnosticHint,
  normalizeFailureCause,
  sanitizeFailureContext,
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
  readonly noticeVisible: boolean
}

export interface TerminalFailureState {
  readonly incident: TerminalFailureIncident

  readonly additionalIncidentCount: number
}

export interface FailureSnapshot {
  readonly terminal: TerminalFailureState | null

  readonly operations: readonly PresentedFailure[]

  readonly degradedFeatures: ReadonlyMap<string, PresentedFailure>

  readonly quarantinedDocuments: ReadonlyMap<string, PresentedFailure>
}

export interface FailureSignal extends Omit<ClassifiedFailureInput, 'technicalMessage'> {
  readonly technicalMessage?: string

  readonly diagnostic?: FailureDiagnosticHint
}

export type FailureListener = () => void

const EMPTY_SNAPSHOT: FailureSnapshot = Object.freeze({
  terminal: null,

  operations: Object.freeze([]),

  degradedFeatures: new Map(),

  quarantinedDocuments: new Map(),
})

const MAX_OPERATION_FAILURES = 20

export class FailureCoordinator {
  private snapshot: FailureSnapshot = EMPTY_SNAPSHOT

  private readonly listeners = new Set<FailureListener>()

  private readonly operations: PresentedFailure[] = []

  private readonly degradedFeatures = new Map<string, PresentedFailure>()

  private readonly quarantinedDocuments = new Map<string, PresentedFailure>()

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

    this.recordDiagnostic(incident)

    if (isTerminalFailureImpact(incident.impact)) {
      return this.reportTerminal(incident as TerminalFailureIncident)
    }

    return this.reportNonTerminal(incident as NonTerminalFailureIncident)
  }

  dismiss(incidentId: string): void {
    const operationIndex = this.operations.findIndex((entry) => entry.incident.id === incidentId)

    if (operationIndex >= 0) {
      this.operations.splice(operationIndex, 1)

      this.publish()
      return
    }

    if (hideScopedNotice(this.degradedFeatures, incidentId)) {
      this.publish()
    }
  }

  resolveScope(scope: FailureScope): void {
    const scopeKey = createFailureScopeKey(scope)

    if (scope.kind === 'feature') {
      this.degradedFeatures.delete(scope.featureId)
    }

    if (scope.kind === 'document') {
      this.quarantinedDocuments.delete(scope.documentId)
    }

    for (let index = this.operations.length - 1; index >= 0; index -= 1) {
      const entry = this.operations[index]

      if (entry && createFailureScopeKey(entry.incident.scope) === scopeKey) {
        this.operations.splice(index, 1)
      }
    }

    this.publish()
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
      this.snapshot = Object.freeze({
        ...this.snapshot,

        terminal: Object.freeze({
          incident: current.incident,

          additionalIncidentCount: current.additionalIncidentCount + 1,
        }),
      })

      this.emit()
      return current.incident
    }

    this.snapshot = Object.freeze({
      ...this.snapshot,

      terminal: Object.freeze({
        incident,
        additionalIncidentCount: 0,
      }),
    })

    this.emit()
    return incident
  }

  private reportNonTerminal(incident: NonTerminalFailureIncident): NonTerminalFailureIncident {
    switch (incident.impact) {
      case 'recoverable':
        this.recordOperation(incident)

        break

      case 'feature-degraded':
        if (incident.scope.kind !== 'feature') {
          throw new Error('Feature failure requires feature scope.')
        }

        this.recordScoped(this.degradedFeatures, incident.scope.featureId, incident, true)

        break

      case 'document-fatal':
        if (incident.scope.kind !== 'document') {
          throw new Error('Document failure requires document scope.')
        }

        this.recordScoped(this.quarantinedDocuments, incident.scope.documentId, incident, false)

        break
    }

    this.publish()
    return incident
  }

  private recordOperation(incident: NonTerminalFailureIncident): void {
    const existingIndex = this.operations.findIndex(
      (entry) => entry.incident.fingerprint === incident.fingerprint,
    )

    const existing = existingIndex >= 0 ? this.operations[existingIndex] : undefined

    if (existingIndex >= 0) {
      this.operations.splice(existingIndex, 1)
    }

    this.operations.push(
      Object.freeze({
        incident,
        occurrences: (existing?.occurrences ?? 0) + 1,

        noticeVisible: true,
      }),
    )

    if (this.operations.length > MAX_OPERATION_FAILURES) {
      this.operations.splice(0, this.operations.length - MAX_OPERATION_FAILURES)
    }
  }

  private recordScoped(
    target: Map<string, PresentedFailure>,

    key: string,

    incident: NonTerminalFailureIncident,

    noticeVisible: boolean,
  ): void {
    const existing = target.get(key)

    target.set(
      key,
      Object.freeze({
        incident,
        occurrences: (existing?.occurrences ?? 0) + 1,

        noticeVisible,
      }),
    )
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      terminal: this.snapshot.terminal,

      operations: Object.freeze([...this.operations]),

      degradedFeatures: new Map(this.degradedFeatures),

      quarantinedDocuments: new Map(this.quarantinedDocuments),
    })

    this.emit()
  }

  private recordDiagnostic(incident: FailureIncident): void {
    try {
      reportDiagnosticError(incident.technicalMessage, {
        ...incident.context,

        failureId: incident.id,

        failureCode: incident.code,

        failureImpact: incident.impact,

        failureRecovery: incident.recovery,

        failureScope: createFailureScopeKey(incident.scope),
      })
    } catch (error: unknown) {
      try {
        console.error('[Poietica] Failure diagnostic reporting failed', error)
      } catch {
        // No further safe fallback.
      }
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error: unknown) {
        try {
          console.error('[Poietica] Failure coordinator listener failed', error)
        } catch {
          // No further safe fallback.
        }
      }
    }
  }
}

export const failureCoordinator = new FailureCoordinator()

function hideScopedNotice(
  failures: Map<string, PresentedFailure>,

  incidentId: string,
): boolean {
  for (const [key, entry] of failures) {
    if (entry.incident.id !== incidentId) {
      continue
    }

    failures.set(
      key,
      Object.freeze({
        ...entry,
        noticeVisible: false,
      }),
    )

    return true
  }

  return false
}

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
