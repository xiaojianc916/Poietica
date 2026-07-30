export interface DiagnosticContext {
  readonly requestId?: string
  readonly correlationId?: string
  readonly spanId?: string
  readonly userId?: string
}

let globalContext: DiagnosticContext = {}

export function setDiagnosticContext(ctx: DiagnosticContext): void {
  globalContext = { ...globalContext, ...ctx }
}

export function getDiagnosticContext(): DiagnosticContext {
  return { ...globalContext }
}

export function resetDiagnosticContext(): void {
  globalContext = {}
}
