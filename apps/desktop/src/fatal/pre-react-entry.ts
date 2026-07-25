import { failureCoordinator } from '../application/failures/failure-coordinator'
import { installFatalCollectors } from './fatal-collectors'
import { isReactFatalHostMounted } from './fatal-runtime'
import type { TerminalFailureViewModel } from './terminal-failure-view-model'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'

installFatalCollectors()

failureCoordinator.subscribe(() => {
  if (isReactFatalHostMounted()) {
    return
  }

  const terminal = failureCoordinator.getSnapshot().terminal

  if (!terminal) {
    return
  }

  const model = createTerminalFailureViewModel(terminal.incident, terminal.additionalIncidentCount)

  renderPreReactFatalScreen(model)
})

function renderPreReactFatalScreen(model: TerminalFailureViewModel): void {
  const root = document.getElementById('root')

  if (!root) {
    try {
      console.error('[Poietica] Root element unavailable', model.summary)
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

  actions.setAttribute('aria-label', '错误处理操作')
  actions.setAttribute('role', 'group')

  const primaryAction = model.primaryAction

  if (primaryAction) {
    const reloadButton = createIconButton(
      'fatal-icon-button fatal-icon-button-primary',
      primaryAction.label,
      createReloadIcon(),
    )

    reloadButton.onclick = () => {
      executePrimaryAction(primaryAction)
    }

    actions.append(reloadButton)
  }

  const copyButton = createIconButton('fatal-icon-button', model.copyActionLabel, createCopyIcon())

  let copyResetTimer: number | undefined

  copyButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(model.diagnostic)

      setCopyButtonState(copyButton, model.copySuccessLabel, createCheckIcon())

      if (copyResetTimer !== undefined) {
        window.clearTimeout(copyResetTimer)
      }

      copyResetTimer = window.setTimeout(() => {
        setCopyButtonState(copyButton, model.copyActionLabel, createCopyIcon())

        copyResetTimer = undefined
      }, 2200)
    } catch {
      setCopyButtonState(copyButton, model.copyActionLabel, createCopyIcon())

      details.open = true
    }
  }

  actions.append(copyButton)

  content.append(icon, title, description, summary)

  if (model.additionalIncidentMessage) {
    content.append(createTextElement('p', 'fatal-secondary', model.additionalIncidentMessage))
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

function createIconButton(className: string, label: string, icon: string): HTMLButtonElement {
  const button = createElement('button', className)

  button.setAttribute('type', 'button')
  button.setAttribute('aria-label', label)
  button.setAttribute('title', label)

  button.innerHTML = icon

  return button
}

function setCopyButtonState(button: HTMLButtonElement, label: string, icon: string): void {
  button.setAttribute('aria-label', label)
  button.setAttribute('title', label)

  button.innerHTML = icon
}

function createReloadIcon(): string {
  return [
    '<svg',
    ' viewBox="0 0 24 24"',
    ' fill="none"',
    ' stroke="currentColor"',
    ' stroke-width="1.8"',
    ' stroke-linecap="round"',
    ' stroke-linejoin="round"',
    ' aria-hidden="true"',
    '>',
    '<path d="M20 11a8 8 0 1 0 2 5.3" />',
    '<path d="M20 4v7h-7" />',
    '</svg>',
  ].join('')
}

function createCopyIcon(): string {
  return [
    '<svg',
    ' viewBox="0 0 24 24"',
    ' fill="none"',
    ' stroke="currentColor"',
    ' stroke-width="1.8"',
    ' stroke-linecap="round"',
    ' stroke-linejoin="round"',
    ' aria-hidden="true"',
    '>',
    '<rect x="9" y="8" width="10" height="13" rx="2" />',
    '<path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />',
    '</svg>',
  ].join('')
}

function createCheckIcon(): string {
  return [
    '<svg',
    ' viewBox="0 0 24 24"',
    ' fill="none"',
    ' stroke="currentColor"',
    ' stroke-width="2"',
    ' stroke-linecap="round"',
    ' stroke-linejoin="round"',
    ' aria-hidden="true"',
    '>',
    '<path d="m5 12 4.2 4.2L19 6.5" />',
    '</svg>',
  ].join('')
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
