import { failureCoordinator } from '../application/failures/failure-coordinator'
import type { TerminalFailureViewModel } from './terminal-failure-view-model'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'
import { installFatalCollectors } from './fatal-collectors'
import { isReactFatalHostMounted } from './fatal-runtime'

installFatalCollectors()

failureCoordinator.subscribe(() => {
  if (isReactFatalHostMounted()) {
    return
  }

  const terminal = failureCoordinator.getSnapshot().terminal

  if (!terminal) {
    return
  }

  const model = createTerminalFailureViewModel(
    terminal.incident,

    terminal.additionalIncidentCount,
  )

  renderPreReactFatalScreen(model)
})

function renderPreReactFatalScreen(model: TerminalFailureViewModel): void {
  const root = document.getElementById('root')

  if (!root) {
    try {
      console.error('[Hybrid Canvas] Root element unavailable', model.summary)
    } catch {
      // No further safe fallback.
    }

    return
  }

  root.replaceChildren(createFatalSurface(model))
}

function createFatalSurface(model: TerminalFailureViewModel): HTMLElement {
  const main = createElement('main', 'fatal-surface')

  main.setAttribute('role', 'alert')

  main.setAttribute('aria-live', 'assertive')

  const content = createElement('section', 'fatal-content')

  const icon = createElement('div', 'fatal-icon')

  icon.setAttribute('aria-hidden', 'true')

  icon.innerHTML = createWarningIcon()

  const title = createTextElement('h1', 'fatal-title', model.title)

  const description = createTextElement('p', 'fatal-description', model.description)

  const summary = createTextElement('p', 'fatal-summary', model.summary)

  const details = createElement('details', 'fatal-details')

  const detailsSummary = createTextElement('summary', undefined, model.detailsLabel)

  const diagnostic = createTextElement('pre', 'fatal-diagnostic', model.diagnostic)

  details.append(detailsSummary, diagnostic)

  const actions = createElement('div', 'fatal-actions')

  if (model.primaryAction) {
    const primaryButton = createTextElement(
      'button',
      'fatal-button fatal-button-primary',

      model.primaryAction.label,
    )

    primaryButton.setAttribute('type', 'button')

    primaryButton.onclick = () => {
      executePrimaryAction(model.primaryAction)
    }

    actions.append(primaryButton)
  }

  const copyButton = createTextElement('button', 'fatal-button', model.copyActionLabel)

  copyButton.setAttribute('type', 'button')

  copyButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(model.diagnostic)

      copyButton.textContent = model.copySuccessLabel
    } catch {
      copyButton.textContent = model.copyFailureLabel

      details.open = true
    }
  }

  actions.append(copyButton)

  content.append(icon, title, description, summary)

  if (model.additionalIncidentMessage) {
    content.append(
      createTextElement(
        'p',
        'fatal-secondary',

        model.additionalIncidentMessage,
      ),
    )
  }

  content.append(actions, details)

  main.append(content)

  return main
}

function executePrimaryAction(action: { readonly kind: 'reload' }): void {
  switch (action.kind) {
    case 'reload':
      window.location.reload()
  }
}

function createElement<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  className?: string,
): HTMLElementTagNameMap[TagName] {
  const element = document.createElement(tagName)

  if (className) {
    element.className = className
  }

  return element
}

function createTextElement<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  className: string | undefined,
  text: string,
): HTMLElementTagNameMap[TagName] {
  const element = createElement(tagName, className)

  element.textContent = text

  return element
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
