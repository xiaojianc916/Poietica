import type { FailureImpact } from '@hybrid-canvas/foundations-kernel'
import { FatalIncidentController } from './fatal-controller'
import type { CreateFatalIncidentInput, FatalIncident } from './fatal-incident'

/**
 * Fatal escalation is deliberately restricted to process-wide failure.
 *
 * Recoverable, feature-degraded and document-scoped failures must not
 * enter the global fatal state machine.
 */
export type FatalEscalationImpact = Extract<FailureImpact, 'application-fatal' | 'native-fatal'>

export interface FatalEscalationInput extends CreateFatalIncidentInput {
  readonly impact: FatalEscalationImpact
}

export const fatalIncidentController = new FatalIncidentController()

/**
 * The only production gateway allowed to enter terminal fatal state.
 */
export function reportFatalIncident(input: FatalEscalationInput): FatalIncident {
  const { impact, ...incidentInput } = input

  return fatalIncidentController.report({
    ...incidentInput,
    context: {
      ...(incidentInput.context ?? {}),
      failureImpact: impact,
    },
  })
}

let reactFatalHostMounted = false

export function markReactFatalHostMounted(): void {
  reactFatalHostMounted = true
}

export function isReactFatalHostMounted(): boolean {
  return reactFatalHostMounted
}
