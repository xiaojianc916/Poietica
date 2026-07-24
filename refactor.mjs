import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  viewModel: 'apps/desktop/src/fatal/terminal-failure-view-model.ts',

  viewModelTest: 'apps/desktop/src/fatal/terminal-failure-view-model.test.ts',

  reactScreen: 'apps/desktop/src/fatal/FatalErrorScreen.tsx',

  preReact: 'apps/desktop/src/fatal/pre-react-entry.ts',

  architectureCheck: 'tests/architecture/check-failure-architecture-convergence.mjs',

  adr: 'docs/adr/ADR-011-unified-failure-coordinator.md',
})

async function main() {
  await assertRepository()

  await writeTerminalViewModel()
  await writeTerminalViewModelTests()
  await writeReactFatalScreen()
  await writePreReactEntry()
  await strengthenArchitectureCheck()
  await updateArchitectureDecision()
  await verifyConvergence()

  console.log('')
  console.log('Terminal Failure ViewModel unified.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function writeTerminalViewModel() {
  const source = `import type {
  TerminalFailureIncident,
} from '../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'

export interface TerminalFailurePrimaryAction {
  readonly kind: 'reload'
  readonly label: string
}

export interface TerminalFailureViewModel {
  readonly title: string
  readonly description: string
  readonly summary: string

  readonly additionalIncidentMessage?:
    string

  readonly primaryAction:
    TerminalFailurePrimaryAction | null

  readonly copyActionLabel: string
  readonly copySuccessLabel: string
  readonly copyFailureLabel: string
  readonly detailsLabel: string
  readonly diagnostic: string
}

export function createTerminalFailureViewModel(
  incident:
    TerminalFailureIncident,

  additionalIncidentCount = 0,
): TerminalFailureViewModel {
  return Object.freeze({
    title:
      resolvePresentationTitle(
        incident,
      ),

    description:
      incident.userMessage,

    summary:
      incident.code +
      ' · ' +
      incident.id,

    ...optionalProperty(
      'additionalIncidentMessage',
      createAdditionalIncidentMessage(
        additionalIncidentCount,
      ),
    ),

    primaryAction:
      createPrimaryAction(
        incident,
      ),

    copyActionLabel:
      '复制诊断信息',

    copySuccessLabel:
      '已复制',

    copyFailureLabel:
      '复制失败，请手动选择',

    detailsLabel:
      '查看诊断信息',

    diagnostic:
      formatFailureDiagnostic(
        incident,
      ),
  })
}

function resolvePresentationTitle(
  incident:
    TerminalFailureIncident,
): string {
  const configuredTitle =
    incident.context[
      'presentationTitle'
    ]

  if (
    typeof configuredTitle ===
      'string' &&
    configuredTitle.trim().length >
      0
  ) {
    return configuredTitle
  }

  return incident.impact ===
    'native-fatal'
    ? '应用上次异常终止'
    : '应用遇到严重错误'
}

function createPrimaryAction(
  incident:
    TerminalFailureIncident,
): TerminalFailurePrimaryAction | null {
  switch (incident.recovery) {
    case 'reload':
      return Object.freeze({
        kind: 'reload',
        label: '重新加载',
      })

    case 'restart':
      return Object.freeze({
        kind: 'reload',
        label: '重新加载应用',
      })

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

function createAdditionalIncidentMessage(
  count: number,
): string | undefined {
  if (
    !Number.isInteger(count) ||
    count <= 0
  ) {
    return undefined
  }

  return (
    '此后还捕获到 ' +
    String(count) +
    ' 个相关异常。'
  )
}

function optionalProperty<
  Key extends string,
  Value,
>(
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
`

  await writeText(FILES.viewModel, source)
}

async function writeTerminalViewModelTests() {
  const source = `import {
  describe,
  expect,
  it,
} from 'vitest'
import {
  FailureCoordinator,
  type TerminalFailureIncident,
} from '../application/failures/failure-coordinator'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'

describe(
  'createTerminalFailureViewModel',
  () => {
    it('projects application fatal state', () => {
      const incident =
        createTerminalIncident({
          impact:
            'application-fatal',

          code:
            'APPLICATION_FATAL',

          userMessage:
            '应用无法继续运行。',

          recovery: 'reload',

          scope: {
            kind: 'application',
          },

          cause:
            new Error(
              'render failed',
            ),
        })

      const model =
        createTerminalFailureViewModel(
          incident,
        )

      expect(model.title).toBe(
        '应用遇到严重错误',
      )

      expect(
        model.description,
      ).toBe(
        '应用无法继续运行。',
      )

      expect(
        model.primaryAction,
      ).toEqual({
        kind: 'reload',
        label: '重新加载',
      })

      expect(model.summary).toContain(
        'APPLICATION_FATAL',
      )

      expect(
        model.diagnostic,
      ).toContain(
        'render failed',
      )
    })

    it('projects native fatal state', () => {
      const incident =
        createTerminalIncident({
          impact: 'native-fatal',

          code:
            'NATIVE_PROCESS_FATAL',

          userMessage:
            '应用上次运行时异常终止。',

          recovery: 'reload',

          scope: {
            kind:
              'native-process',
          },

          cause:
            new Error(
              'native panic',
            ),
        })

      const model =
        createTerminalFailureViewModel(
          incident,
        )

      expect(model.title).toBe(
        '应用上次异常终止',
      )
    })

    it('uses an explicit presentation title', () => {
      const incident =
        createTerminalIncident({
          impact:
            'application-fatal',

          code:
            'CUSTOM_FATAL',

          userMessage:
            '应用无法继续运行。',

          recovery: 'reload',

          scope: {
            kind: 'application',
          },

          cause:
            new Error('failure'),

          context: {
            presentationTitle:
              '无法完成应用启动',
          },
        })

      const model =
        createTerminalFailureViewModel(
          incident,
        )

      expect(model.title).toBe(
        '无法完成应用启动',
      )
    })

    it('projects additional incident count', () => {
      const incident =
        createTerminalIncident({
          impact:
            'application-fatal',

          code:
            'PRIMARY_FATAL',

          userMessage:
            '应用无法继续运行。',

          recovery: 'reload',

          scope: {
            kind: 'application',
          },

          cause:
            new Error('failure'),
        })

      const model =
        createTerminalFailureViewModel(
          incident,
          3,
        )

      expect(
        model.additionalIncidentMessage,
      ).toBe(
        '此后还捕获到 3 个相关异常。',
      )
    })

    it('does not invent unsupported actions', () => {
      const incident =
        createTerminalIncident({
          impact:
            'application-fatal',

          code:
            'NO_RECOVERY_FATAL',

          userMessage:
            '应用无法继续运行。',

          recovery: 'none',

          scope: {
            kind: 'application',
          },

          cause:
            new Error('failure'),
        })

      const model =
        createTerminalFailureViewModel(
          incident,
        )

      expect(
        model.primaryAction,
      ).toBeNull()
    })
  },
)

function createTerminalIncident(
  signal: Parameters<
    FailureCoordinator['report']
  >[0],
): TerminalFailureIncident {
  const coordinator =
    new FailureCoordinator()

  coordinator.report(signal)

  const terminal =
    coordinator.getSnapshot()
      .terminal

  if (!terminal) {
    throw new Error(
      'Expected terminal failure state.',
    )
  }

  return terminal.incident
}
`

  await writeText(FILES.viewModelTest, source)
}

async function writeReactFatalScreen() {
  const source = `import {
  useMemo,
  useState,
} from 'react'
import type {
  TerminalFailureIncident,
} from '../application/failures/failure-coordinator'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'

export interface FatalErrorScreenProps {
  readonly incident:
    TerminalFailureIncident

  readonly additionalIncidentCount?:
    number
}

export function FatalErrorScreen({
  incident,
  additionalIncidentCount = 0,
}: FatalErrorScreenProps) {
  const [copyState, setCopyState] =
    useState<
      'idle' | 'copied' | 'failed'
    >('idle')

  const model = useMemo(
    () =>
      createTerminalFailureViewModel(
        incident,
        additionalIncidentCount,
      ),

    [
      additionalIncidentCount,
      incident,
    ],
  )

  const copyDiagnostic =
    async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(
          model.diagnostic,
        )

        setCopyState('copied')
      } catch {
        setCopyState('failed')
      }
    }

  return (
    <main
      aria-live="assertive"
      className="fatal-surface"
      role="alert"
    >
      <section className="fatal-content">
        <div
          aria-hidden="true"
          className="fatal-icon"
        >
          <WarningIcon />
        </div>

        <h1 className="fatal-title">
          {model.title}
        </h1>

        <p className="fatal-description">
          {model.description}
        </p>

        <p className="fatal-summary">
          {model.summary}
        </p>

        {model.additionalIncidentMessage ? (
          <p className="fatal-secondary">
            {
              model.additionalIncidentMessage
            }
          </p>
        ) : null}

        <div className="fatal-actions">
          {model.primaryAction ? (
            <button
              className="fatal-button fatal-button-primary"
              onClick={() => {
                executePrimaryAction(
                  model.primaryAction,
                )
              }}
              type="button"
            >
              {
                model.primaryAction
                  .label
              }
            </button>
          ) : null}

          <button
            className="fatal-button"
            onClick={() => {
              void copyDiagnostic()
            }}
            type="button"
          >
            {copyState === 'copied'
              ? model.copySuccessLabel
              : copyState ===
                  'failed'
                ? model.copyFailureLabel
                : model.copyActionLabel}
          </button>
        </div>

        <details
          className="fatal-details"
          open={
            copyState === 'failed'
          }
        >
          <summary>
            {model.detailsLabel}
          </summary>

          <pre className="fatal-diagnostic">
            {model.diagnostic}
          </pre>
        </details>
      </section>
    </main>
  )
}

function executePrimaryAction(
  action: {
    readonly kind: 'reload'
  },
): void {
  switch (action.kind) {
    case 'reload':
      window.location.reload()
  }
}

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M12 8.5v4.25" />
      <path d="M12 16.25h.01" />

      <path d="M10.28 3.86 2.82 16.8a2 2 0 0 0 1.73 3h14.9a2 2 0 0 0 1.73-3L13.72 3.86a2 2 0 0 0-3.44 0Z" />
    </svg>
  )
}
`

  await writeText(FILES.reactScreen, source)
}

async function writePreReactEntry() {
  const source = `import { failureCoordinator } from '../application/failures/failure-coordinator'
import type {
  TerminalFailureViewModel,
} from './terminal-failure-view-model'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'
import { installFatalCollectors } from './fatal-collectors'
import { isReactFatalHostMounted } from './fatal-runtime'

installFatalCollectors()

failureCoordinator.subscribe(
  () => {
    if (
      isReactFatalHostMounted()
    ) {
      return
    }

    const terminal =
      failureCoordinator
        .getSnapshot()
        .terminal

    if (!terminal) {
      return
    }

    const model =
      createTerminalFailureViewModel(
        terminal.incident,

        terminal
          .additionalIncidentCount,
      )

    renderPreReactFatalScreen(
      model,
    )
  },
)

function renderPreReactFatalScreen(
  model:
    TerminalFailureViewModel,
): void {
  const root =
    document.getElementById(
      'root',
    )

  if (!root) {
    try {
      console.error(
        '[Hybrid Canvas] Root element unavailable',
        model.summary,
      )
    } catch {
      // No further safe fallback.
    }

    return
  }

  root.replaceChildren(
    createFatalSurface(model),
  )
}

function createFatalSurface(
  model:
    TerminalFailureViewModel,
): HTMLElement {
  const main =
    createElement(
      'main',
      'fatal-surface',
    )

  main.setAttribute(
    'role',
    'alert',
  )

  main.setAttribute(
    'aria-live',
    'assertive',
  )

  const content =
    createElement(
      'section',
      'fatal-content',
    )

  const icon =
    createElement(
      'div',
      'fatal-icon',
    )

  icon.setAttribute(
    'aria-hidden',
    'true',
  )

  icon.innerHTML =
    createWarningIcon()

  const title =
    createTextElement(
      'h1',
      'fatal-title',
      model.title,
    )

  const description =
    createTextElement(
      'p',
      'fatal-description',
      model.description,
    )

  const summary =
    createTextElement(
      'p',
      'fatal-summary',
      model.summary,
    )

  const details =
    createElement(
      'details',
      'fatal-details',
    )

  const detailsSummary =
    createTextElement(
      'summary',
      undefined,
      model.detailsLabel,
    )

  const diagnostic =
    createTextElement(
      'pre',
      'fatal-diagnostic',
      model.diagnostic,
    )

  details.append(
    detailsSummary,
    diagnostic,
  )

  const actions =
    createElement(
      'div',
      'fatal-actions',
    )

  if (model.primaryAction) {
    const primaryButton =
      createTextElement(
        'button',
        'fatal-button fatal-button-primary',

        model.primaryAction.label,
      )

    primaryButton.setAttribute(
      'type',
      'button',
    )

    primaryButton.onclick =
      () => {
        executePrimaryAction(
          model.primaryAction,
        )
      }

    actions.append(
      primaryButton,
    )
  }

  const copyButton =
    createTextElement(
      'button',
      'fatal-button',
      model.copyActionLabel,
    )

  copyButton.setAttribute(
    'type',
    'button',
  )

  copyButton.onclick =
    async () => {
      try {
        await navigator.clipboard.writeText(
          model.diagnostic,
        )

        copyButton.textContent =
          model.copySuccessLabel
      } catch {
        copyButton.textContent =
          model.copyFailureLabel

        details.open = true
      }
    }

  actions.append(copyButton)

  content.append(
    icon,
    title,
    description,
    summary,
  )

  if (
    model.additionalIncidentMessage
  ) {
    content.append(
      createTextElement(
        'p',
        'fatal-secondary',

        model
          .additionalIncidentMessage,
      ),
    )
  }

  content.append(
    actions,
    details,
  )

  main.append(content)

  return main
}

function executePrimaryAction(
  action: {
    readonly kind: 'reload'
  },
): void {
  switch (action.kind) {
    case 'reload':
      window.location.reload()
  }
}

function createElement<
  TagName extends keyof HTMLElementTagNameMap,
>(
  tagName: TagName,
  className?: string,
): HTMLElementTagNameMap[TagName] {
  const element =
    document.createElement(
      tagName,
    )

  if (className) {
    element.className =
      className
  }

  return element
}

function createTextElement<
  TagName extends keyof HTMLElementTagNameMap,
>(
  tagName: TagName,
  className: string | undefined,
  text: string,
): HTMLElementTagNameMap[TagName] {
  const element =
    createElement(
      tagName,
      className,
    )

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
`

  await writeText(FILES.preReact, source)
}

async function strengthenArchitectureCheck() {
  const file = resolvePath(FILES.architectureCheck)

  let source = await readFile(file, 'utf8')

  if (!source.includes(FILES.viewModel)) {
    source = source.replace(
      `  'apps/desktop/src/application/failures/failure-diagnostic.ts',`,
      `  'apps/desktop/src/application/failures/failure-diagnostic.ts',
  'apps/desktop/src/fatal/terminal-failure-view-model.ts',
  'apps/desktop/src/fatal/terminal-failure-view-model.test.ts',`,
    )
  }

  if (!source.includes('Terminal renderers do not share the canonical ViewModel.')) {
    const marker = '  scanProductionSources()'

    const validation = `  const terminalViewModel = read(
    'apps/desktop/src/fatal/terminal-failure-view-model.ts',
  )

  const reactRenderer = read(
    'apps/desktop/src/fatal/FatalErrorScreen.tsx',
  )

  const preReactRenderer = read(
    'apps/desktop/src/fatal/pre-react-entry.ts',
  )

  requireText(
    terminalViewModel,
    'createTerminalFailureViewModel',
    'Terminal Failure ViewModel factory is missing.',
  )

  requireText(
    reactRenderer,
    'createTerminalFailureViewModel',
    'React Fatal renderer does not consume the canonical ViewModel.',
  )

  requireText(
    preReactRenderer,
    'createTerminalFailureViewModel',
    'Pre-React Fatal renderer does not consume the canonical ViewModel.',
  )

  for (
    const [
      rendererName,
      renderer,
    ] of [
      [
        'React',
        reactRenderer,
      ],
      [
        'Pre-React',
        preReactRenderer,
      ],
    ]
  ) {
    if (
      renderer.includes(
        'incident.impact',
      ) ||
      renderer.includes(
        'formatFailureDiagnostic',
      )
    ) {
      failures.push(
        rendererName +
          ' Terminal renderer bypasses the canonical ViewModel.',
      )
    }
  }

  if (
    !reactRenderer.includes(
      'createTerminalFailureViewModel',
    ) ||
    !preReactRenderer.includes(
      'createTerminalFailureViewModel',
    )
  ) {
    failures.push(
      'Terminal renderers do not share the canonical ViewModel.',
    )
  }

  scanProductionSources()`

    source = replaceRequired(source, marker, validation, FILES.architectureCheck)
  }

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.architectureCheck + ': strengthened.')
}

async function updateArchitectureDecision() {
  const file = resolvePath(FILES.adr)

  let source = await readFile(file, 'utf8')

  if (source.includes('## Terminal presentation')) {
    return
  }

  const section = `

## Terminal presentation

React and pre-React terminal renderers consume one pure
TerminalFailureViewModel.

The ViewModel owns title, description, summary, recovery presentation,
additional-incident text and formatted diagnostics.

Renderers own only platform-specific element creation, clipboard state and
execution of the selected primary action.

Neither renderer may classify failure impact or format diagnostics directly.
`

  source = source.trimEnd() + section

  await writeFile(file, normalizeText(source), 'utf8')
}

async function verifyConvergence() {
  const viewModel = await readFile(resolvePath(FILES.viewModel), 'utf8')

  const reactRenderer = await readFile(resolvePath(FILES.reactScreen), 'utf8')

  const preReactRenderer = await readFile(resolvePath(FILES.preReact), 'utf8')

  const violations = []

  if (!viewModel.includes('createTerminalFailureViewModel')) {
    violations.push('Terminal ViewModel factory is missing.')
  }

  for (const [name, source] of [
    [FILES.reactScreen, reactRenderer],

    [FILES.preReact, preReactRenderer],
  ]) {
    if (!source.includes('createTerminalFailureViewModel')) {
      violations.push(name + ': ViewModel is not consumed.')
    }

    if (source.includes('incident.impact')) {
      violations.push(name + ': renderer still classifies impact.')
    }

    if (source.includes('formatFailureDiagnostic')) {
      violations.push(name + ': renderer still formats diagnostics.')
    }
  }

  if (violations.length > 0) {
    throw new Error(
      [
        'Terminal ViewModel verification failed:',
        ...violations.map((violation) => '- ' + violation),
      ].join('\n'),
    )
  }
}

async function writeText(relativePath, source) {
  await writeFile(resolvePath(relativePath), normalizeText(source), 'utf8')

  console.log(relativePath + ': written.')
}

function replaceRequired(source, oldText, newText, file) {
  if (source.includes(newText)) {
    return source
  }

  if (!source.includes(oldText)) {
    throw new Error('Could not find expected text in ' + file + ': ' + oldText)
  }

  return source.replace(oldText, newText)
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath)
}

main().catch((error) => {
  console.error('')
  console.error('Terminal Failure ViewModel convergence failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
