import { describe, expect, it, vi } from 'vitest'
import { FatalIncidentController, type FatalIncidentFactory } from './fatal-controller'
import type { CreateFatalIncidentInput, FatalIncident } from './fatal-incident'

describe('FatalIncidentController', () => {
  it('starts healthy', () => {
    const controller = createController()

    expect(controller.getSnapshot()).toEqual({
      status: 'healthy',
    })
  })

  it('stores the first fatal incident', () => {
    const controller = createController()

    const incident = controller.report(createInput('FIRST'))

    expect(controller.getSnapshot()).toEqual({
      status: 'fatal',
      incident,
      additionalIncidentCount: 0,
    })
  })

  it('keeps the first fatal incident as the primary failure', () => {
    const controller = createController()

    const first = controller.report(createInput('FIRST'))

    controller.report(createInput('SECOND'))

    expect(controller.getSnapshot()).toEqual({
      status: 'fatal',
      incident: first,
      additionalIncidentCount: 1,
    })
  })

  it('deduplicates incidents with the same fingerprint', () => {
    const controller = createController()

    const first = controller.report(createInput('DUPLICATE'))

    const second = controller.report(createInput('DUPLICATE'))

    expect(second).toBe(first)

    expect(controller.getSnapshot()).toEqual({
      status: 'fatal',
      incident: first,
      additionalIncidentCount: 0,
    })
  })

  it('notifies subscribers after state transitions', () => {
    const controller = createController()

    const listener = vi.fn()

    const unsubscribe = controller.subscribe(listener)

    controller.report(createInput('FIRST'))

    expect(listener).toHaveBeenCalledTimes(1)

    controller.report(createInput('SECOND'))

    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()

    controller.report(createInput('THIRD'))

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('isolates a failing subscriber', () => {
    const controller = createController()

    const healthyListener = vi.fn()

    controller.subscribe(() => {
      throw new Error('listener failed')
    })

    controller.subscribe(healthyListener)

    expect(() => {
      controller.report(createInput('FIRST'))
    }).not.toThrow()

    expect(healthyListener).toHaveBeenCalledTimes(1)
  })

  it('keeps getSnapshot stable until a transition occurs', () => {
    const controller = createController()

    const healthyOne = controller.getSnapshot()

    const healthyTwo = controller.getSnapshot()

    expect(healthyOne).toBe(healthyTwo)

    controller.report(createInput('FIRST'))

    const fatalOne = controller.getSnapshot()

    const fatalTwo = controller.getSnapshot()

    expect(fatalOne).toBe(fatalTwo)
    expect(fatalOne).not.toBe(healthyOne)
  })
})

function createController(): FatalIncidentController {
  let sequence = 0

  const factory: FatalIncidentFactory = (input) => {
    sequence += 1

    return createIncident(input, sequence)
  }

  return new FatalIncidentController(factory)
}

function createInput(code: string): CreateFatalIncidentInput {
  return {
    error: new Error(code),
    kind: 'invariant',
    phase: 'running',
    code,
  }
}

function createIncident(input: CreateFatalIncidentInput, sequence: number): FatalIncident {
  const code = input.code ?? 'UNKNOWN'

  return {
    id: `incident-${String(sequence)}`,
    fingerprint: code,
    severity: 'fatal',
    kind: input.kind,
    phase: input.phase,
    code,
    title: 'Fatal',
    message: 'Fatal',
    technicalMessage: code,
    errorName: 'Error',
    occurredAt: '2026-07-24T00:00:00.000Z',
    pageUrl: 'http://localhost',
    userAgent: 'test',
    recovery: 'reload',
    context: {},
    recentLogs: [],
  }
}
