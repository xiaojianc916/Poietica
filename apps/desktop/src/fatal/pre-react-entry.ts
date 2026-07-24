import {
  failureCoordinator,
  type FailureIncident,
} from '../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'
import { installFatalCollectors } from './fatal-collectors'
import { isReactFatalHostMounted } from './fatal-runtime'

installFatalCollectors()

failureCoordinator.subscribe(() => {
  if (isReactFatalHostMounted()) {
    return
  }

  const snapshot = failureCoordinator.getSnapshot()

  if (!snapshot.terminal) {
    return
  }

  renderPreReactFatalScreen(snapshot.terminal.incident)
})

function renderPreReactFatalScreen(incident: FailureIncident): void {
  const root = document.getElementById('root')

  if (!root) {
    console.error('[Hybrid Canvas] Root element unavailable', incident)

    return
  }

  const diagnostic = formatFailureDiagnostic(incident)

  root.replaceChildren(createFatalSurface(incident, diagnostic))
}

function createFatalSurface(incident: FailureIncident, diagnostic: string): HTMLElement {
  const main = document.createElement('main')

  main.className = 'fatal-surface'

  main.setAttribute('role', 'alert')

  main.setAttribute('aria-live', 'assertive')

  const content = document.createElement('section')

  content.className = 'fatal-content'

  const icon = document.createElement('div')

  icon.className = 'fatal-icon'

  icon.setAttribute('aria-hidden', 'true')

  icon.innerHTML = createWarningIcon()

  const title = document.createElement('h1')

  title.className = 'fatal-title'

  title.textContent = incident.impact === 'native-fatal' ? '应用上次异常终止' : '应用遇到严重错误'

  const description = document.createElement('p')

  description.className = 'fatal-description'

  description.textContent = incident.userMessage

  const summary = document.createElement('p')

  summary.className = 'fatal-summary'

  summary.textContent = `${incident.code} · ${incident.id}`

  const details = document.createElement('details')

  details.className = 'fatal-details'

  const detailsSummary = document.createElement('summary')

  detailsSummary.textContent = '查看诊断信息'

  const pre = document.createElement('pre')

  pre.className = 'fatal-diagnostic'

  pre.textContent = diagnostic

  details.append(detailsSummary, pre)

  const actions = document.createElement('div')

  actions.className = 'fatal-actions'

  const reloadButton = document.createElement('button')

  reloadButton.className = 'fatal-button fatal-button-primary'

  reloadButton.type = 'button'

  reloadButton.textContent = '重新加载'

  reloadButton.onclick = () => {
    window.location.reload()
  }

  const copyButton = document.createElement('button')

  copyButton.className = 'fatal-button'

  copyButton.type = 'button'

  copyButton.textContent = '复制诊断信息'

  copyButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic)

      copyButton.textContent = '已复制'
    } catch {
      copyButton.textContent = '复制失败，请手动选择'

      details.open = true
    }
  }

  actions.append(reloadButton, copyButton)

  content.append(icon, title, description, summary, actions, details)

  main.append(content)

  return main
}

function createWarningIcon(): string {
  return [
    '<svg',
    ' viewBox="0 0 24 24"',
    ' fill="none"',
    ' stroke="currentColor"',
    ' stroke-width="1.7"',
    ' stroke-linecap="round"',
    ' stroke-linejoin="round"',
    ' aria-hidden="true"',
    '>',
    '<path d="M12 8.5v4.25" />',
    '<path d="M12 16.25h.01" />',
    '<path d="M10.28 3.86 2.82 16.8a2 2 0 0 0 1.73 3h14.9a2 2 0 0 0 1.73-3L13.72 3.86a2 2 0 0 0-3.44 0Z" />',
    '</svg>',
  ].join('')
}
