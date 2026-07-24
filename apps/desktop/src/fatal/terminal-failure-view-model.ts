import type { TerminalFailureIncident } from '../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'

export interface TerminalFailurePrimaryAction {
  readonly kind: 'reload'
  readonly label: string
}

export interface TerminalFailureViewModel {
  readonly title: string
  readonly description: string
  readonly summary: string

  readonly additionalIncidentMessage?: string

  readonly primaryAction: TerminalFailurePrimaryAction | null

  readonly copyActionLabel: string
  readonly copySuccessLabel: string
  readonly copyFailureLabel: string
  readonly detailsLabel: string
  readonly diagnostic: string
}

export function createTerminalFailureViewModel(
  incident: TerminalFailureIncident,

  additionalIncidentCount = 0,
): TerminalFailureViewModel {
  return Object.freeze({
    title: resolvePresentationTitle(incident),

    description: incident.userMessage,

    summary: `${incident.code} · ${incident.id}`,

    ...optionalProperty(
      'additionalIncidentMessage',
      createAdditionalIncidentMessage(additionalIncidentCount),
    ),

    primaryAction: createPrimaryAction(incident),

    copyActionLabel: '复制诊断信息',

    copySuccessLabel: '已复制',

    copyFailureLabel: '复制失败，请手动选择',

    detailsLabel: '查看诊断信息',

    diagnostic: formatFailureDiagnostic(incident),
  })
}

function resolvePresentationTitle(incident: TerminalFailureIncident): string {
  const configuredTitle = incident.context['presentationTitle']

  if (typeof configuredTitle === 'string' && configuredTitle.trim().length > 0) {
    return configuredTitle
  }

  return incident.impact === 'native-fatal' ? '应用上次异常终止' : '应用遇到严重错误'
}

function createPrimaryAction(
  incident: TerminalFailureIncident,
): TerminalFailurePrimaryAction | null {
  switch (incident.recovery) {
    case 'reload':
      return Object.freeze({
        kind: 'reload',
        label: '重新加载',
      })

    case 'restart':
    case 'exit':
    case 'none':
      return null

    case 'retry':
    case 'dismiss':
    case 'disable-feature':
    case 'close-document':
      return null
  }
}

function createAdditionalIncidentMessage(count: number): string | undefined {
  if (!Number.isInteger(count) || count <= 0) {
    return undefined
  }

  return `此后还捕获到 ${String(count)} 个相关异常。`
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
