import { failureCoordinator } from '@poietica/agent-runtime'
import { installFatalCollectors } from './fatal-collectors'
import { isReactFatalHostMounted } from './fatal-runtime'
import type { TerminalFailureViewModel } from './terminal-failure-view-model'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'

const errorRobotIllustrationUrl = new URL('./assets/error-robot.svg', import.meta.url).href

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

  presentWindow()
}

/*
 * 窗口以 visible: false 创建，正常路径由 React 首帧之后呈现。这条路径上 React
 * 永远不会挂载，所以崩溃屏必须自己把窗口叫出来。
 */
function presentWindow(): void {
  void import('@poietica/platforms-desktop-runtime')
    .then(({ createMainWindowController }) => createMainWindowController().present())
    .catch(() => {
      // 窗口无法呈现时没有可用的补救界面；原生日志里仍然留有记录。
    })
}

function createFatalSurface(model: TerminalFailureViewModel): HTMLElement {
  const main = createElement('main', 'fatal-surface')

  main.setAttribute('role', 'alert')
  main.setAttribute('aria-live', 'assertive')

  const content = createElement('section', 'fatal-content')

  const illustration = createElement('img', 'fatal-illustration')

  illustration.src = errorRobotIllustrationUrl
  illustration.alt = ''
  illustration.setAttribute('aria-hidden', 'true')

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
      'fatal-icon-button',
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

  content.append(illustration, title, description, summary)

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
  return '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 8c-1.392-3.179-4.823-5-8.522-5C7.299 3 3.453 6.552 3 11.1"/><path d="M16.489 8.4h3.97A.54.54 0 0 0 21 7.86V3.9M3.5 16c1.392 3.179 4.823 5 8.522 5 4.679 0 8.525-3.552 8.978-8.1"/><path d="M7.511 15.6h-3.97a.54.54 0 0 0-.541.54v3.96"/></svg>'
}

function createCopyIcon(): string {
  return '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M20.829 12.861c.171-.413.171-.938.171-1.986s0-1.573-.171-1.986a2.25 2.25 0 0 0-1.218-1.218c-.413-.171-.938-.171-1.986-.171H11.1c-1.26 0-1.89 0-2.371.245a2.25 2.25 0 0 0-.984.984C7.5 9.209 7.5 9.839 7.5 11.1v6.525c0 1.048 0 1.573.171 1.986.229.551.667.99 1.218 1.218.413.171.938.171 1.986.171s1.573 0 1.986-.171m7.968-7.968a2.25 2.25 0 0 1-1.218 1.218c-.413.171-.938.171-1.986.171s-1.573 0-1.986.171a2.25 2.25 0 0 0-1.218 1.218c-.171.413-.171.938-.171 1.986s0 1.573-.171 1.986a2.25 2.25 0 0 1-1.218 1.218m7.968-7.968a11.68 11.68 0 0 1-7.75 7.9l-.218.068M16.5 7.5v-.9c0-1.26 0-1.89-.245-2.371a2.25 2.25 0 0 0-.983-.984C14.79 3 14.16 3 12.9 3H6.6c-1.26 0-1.89 0-2.371.245a2.25 2.25 0 0 0-.984.984C3 4.709 3 5.339 3 6.6v6.3c0 1.26 0 1.89.245 2.371.216.424.56.768.984.984.48.245 1.111.245 2.372.245H7.5"/></svg>'
}

function createCheckIcon(): string {
  return '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"/><path d="m8.667 12.633 1.505 1.721a1 1 0 0 0 1.564-.073L15.333 9.3"/></svg>'
}
