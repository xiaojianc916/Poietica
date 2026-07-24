// apply-feature-degradation-refactor.mjs
//
// 可直接在当前“部分执行”状态上运行，不需要恢复或修改旧 refactor.mjs。
// 此脚本可以重复执行。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  featureAvailability: 'apps/desktop/src/application/failures/feature-availability.ts',

  titleBar: 'apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx',

  appShell: 'apps/desktop/src/presentation/AppShell.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  architectureCheck: 'tests/architecture/check-feature-degradation-enforcement.mjs',

  adr: 'docs/adr/ADR-010-feature-degradation-enforcement.md',
})

async function main() {
  await assertRepository()
  await assertFailureRuntime()

  await writeFeatureAvailability()
  await writeDesktopTitleBar()
  await rewriteAppShell()
  await rewriteWorkspace()
  await writeArchitectureCheck()
  await writeArchitectureDecision()
  await registerArchitectureCheck()

  console.log('')
  console.log('Feature degradation refactor completed.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function assertFailureRuntime() {
  const source = await readFile(
    resolvePath('apps/desktop/src/application/failures/failure-runtime.ts'),
    'utf8',
  )

  if (!source.includes('degradedFeatures')) {
    throw new Error('FailureRuntime.degradedFeatures is missing.')
  }
}

async function writeFeatureAvailability() {
  const source = `export const DEGRADABLE_FEATURE_IDS = [
  'settings',
  'developer-tools',
  'window-controls',
  'window-dragging',
  'window-state-sync',
  'window-close-coordination',
] as const

export type DegradableFeatureId =
  (typeof DEGRADABLE_FEATURE_IDS)[number]

export interface FeatureAvailability {
  readonly degradedFeatures:
    ReadonlySet<string>

  readonly isAvailable: (
    featureId: DegradableFeatureId,
  ) => boolean
}

export function createFeatureAvailability(
  degradedFeatureIds:
    readonly string[],
): FeatureAvailability {
  const degradedFeatures =
    new Set(
      degradedFeatureIds,
    )

  return Object.freeze({
    degradedFeatures,

    isAvailable(
      featureId:
        DegradableFeatureId,
    ): boolean {
      return !degradedFeatures.has(
        featureId,
      )
    },
  })
}
`

  await writeText(FILES.featureAvailability, source)
}

async function writeDesktopTitleBar() {
  const source = `import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from '@mynaui/icons-react'
import type {
  MouseEvent,
  ReactNode,
} from 'react'

const WINDOW_DRAG_EXCLUSION_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[data-window-drag-exclude]',
].join(',')

export interface DesktopTitleBarProps {
  readonly children: ReactNode
  readonly onMinimize: () => void
  readonly onMaximize: () => void
  readonly onClose: () => void
  readonly onStartDragging:
    () => void

  readonly onSidebarToggle:
    () => void

  readonly isSidebarOpen: boolean
  readonly isMaximized: boolean
  readonly sidebarWidth: number

  readonly windowControlsDisabled?:
    boolean

  readonly windowDraggingDisabled?:
    boolean
}

export function DesktopTitleBar({
  children,
  onMinimize,
  onMaximize,
  onClose,
  onStartDragging,
  onSidebarToggle,
  isSidebarOpen,
  isMaximized,
  windowControlsDisabled = false,
  windowDraggingDisabled = false,
}: DesktopTitleBarProps) {
  function handleDragMouseDown(
    event: MouseEvent<HTMLElement>,
  ) {
    if (
      windowDraggingDisabled ||
      event.button !== 0
    ) {
      return
    }

    const target = event.target

    if (
      !(target instanceof Element) ||
      target.closest(
        WINDOW_DRAG_EXCLUSION_SELECTOR,
      )
    ) {
      return
    }

    event.preventDefault()

    if (event.detail === 2) {
      if (
        !windowControlsDisabled
      ) {
        onMaximize()
      }

      return
    }

    onStartDragging()
  }

  const disabledClass =
    windowControlsDisabled
      ? 'cursor-not-allowed opacity-40'
      : ''

  return (
    <div className="flex h-full min-h-0 min-w-0 bg-chrome">
      <div
        aria-label="窗口标题栏"
        className="flex h-full min-h-0 w-full items-stretch"
        onMouseDownCapture={
          handleDragMouseDown
        }
        role="toolbar"
      >
        <div className="flex w-(--activity-rail-width) shrink-0 items-center justify-center border-b border-divider">
          <button
            aria-label={
              isSidebarOpen
                ? '收起侧边栏'
                : '展开侧边栏'
            }
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={
              onSidebarToggle
            }
            type="button"
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </button>
        </div>

        <div
          className="shrink-0 border-b border-divider"
          style={{
            borderRightStyle:
              'solid',

            borderRightWidth:
              isSidebarOpen
                ? 1
                : 0,

            width:
              'var(--workspace-sidebar-column-width, 0px)',
          }}
        />

        <div className="flex min-w-0 flex-1 items-stretch">
          {children}
        </div>

        <div className="flex shrink-0 items-stretch border-b border-divider">
          <button
            aria-label="最小化"
            className={[
              'grid w-11',
              'place-items-center',
              'text-muted-foreground',
              'enabled:hover:bg-black/5',
              'enabled:hover:text-foreground',
              disabledClass,
            ].join(' ')}
            disabled={
              windowControlsDisabled
            }
            onClick={onMinimize}
            title={
              windowControlsDisabled
                ? '窗口控制暂时不可用'
                : '最小化'
            }
            type="button"
          >
            <Minus className="size-3.5" />
          </button>

          <button
            aria-label={
              isMaximized
                ? '还原窗口'
                : '最大化窗口'
            }
            className={[
              'grid w-11',
              'place-items-center',
              'text-muted-foreground',
              'enabled:hover:bg-black/5',
              'enabled:hover:text-foreground',
              disabledClass,
            ].join(' ')}
            disabled={
              windowControlsDisabled
            }
            onClick={onMaximize}
            title={
              windowControlsDisabled
                ? '窗口控制暂时不可用'
                : isMaximized
                  ? '还原窗口'
                  : '最大化窗口'
            }
            type="button"
          >
            {isMaximized ? (
              <Copy
                aria-hidden="true"
                className="size-3.5"
              />
            ) : (
              <Square
                aria-hidden="true"
                className="size-3"
              />
            )}
          </button>

          <button
            aria-label="关闭"
            className="grid w-12 place-items-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
`

  await writeText(FILES.titleBar, source)
}

async function rewriteAppShell() {
  const file = resolvePath(FILES.appShell)

  let source = await readFile(file, 'utf8')

  source = ensureImport(
    source,
    "import { failureRuntime } from '../application/failures/failure-runtime'",
    "import type { ApplicationTerminationCoordinator } from '../application/termination/application-termination-coordinator'",
  )

  source = ensureImport(
    source,
    "import { createFeatureAvailability } from '../application/failures/feature-availability'",
    "import type { ApplicationTerminationCoordinator } from '../application/termination/application-termination-coordinator'",
  )

  if (!source.includes('const failureSnapshot =')) {
    const marker =
      '  const [failedCanvasTitle, setFailedCanvasTitle] = useState<string | null>(null)'

    source = replaceRequired(
      source,
      marker,
      [
        marker,
        '',
        '  const failureSnapshot = useSyncExternalStore(',
        '    failureRuntime.subscribe,',
        '    failureRuntime.getSnapshot,',
        '    failureRuntime.getSnapshot,',
        '  )',
        '',
        '  const featureAvailability = useMemo(',
        '    () =>',
        '      createFeatureAvailability(',
        '        failureSnapshot.degradedFeatures,',
        '      ),',
        '    [failureSnapshot.degradedFeatures],',
        '  )',
      ].join('\n'),
      FILES.appShell,
    )
  }

  source = replaceSection(
    source,
    '  const openSettings =',
    '  const createCanvasWithFeedback =',
    `  const openSettings = useCallback(() => {
    if (
      !featureAvailability.isAvailable(
        'settings',
      )
    ) {
      return
    }

    setSettingsOpen(true)
  }, [featureAvailability])`,
    FILES.appShell,
  )

  source = replaceSection(
    source,
    '  const minimizeWindow =',
    '  const maximizeWindow =',
    `  const minimizeWindow = useCallback(() => {
    if (
      !featureAvailability.isAvailable(
        'window-controls',
      )
    ) {
      return
    }

    void runtime.mainWindow.minimize().catch((cause: unknown) => {
      reportFailure('main window minimize failed', {
        scope: 'app-shell',
        operation: 'minimize-window',
        cause,
      })
    })
  }, [
    featureAvailability,
    runtime.mainWindow,
  ])`,
    FILES.appShell,
  )

  source = replaceSection(
    source,
    '  const maximizeWindow =',
    '  const openDeveloperTools =',
    `  const maximizeWindow = useCallback(() => {
    if (
      !featureAvailability.isAvailable(
        'window-controls',
      )
    ) {
      return
    }

    void runtime.mainWindow.toggleMaximize().catch((cause: unknown) => {
      reportFailure('main window maximize failed', {
        scope: 'app-shell',
        operation: 'toggle-maximize-window',
        cause,
      })
    })
  }, [
    featureAvailability,
    runtime.mainWindow,
  ])`,
    FILES.appShell,
  )

  source = replaceSection(
    source,
    '  const openDeveloperTools =',
    '  const startWindowDragging =',
    `  const openDeveloperTools = useCallback(() => {
    if (
      !featureAvailability.isAvailable(
        'developer-tools',
      )
    ) {
      return
    }

    void runtime.mainWindow.openDeveloperTools().catch((cause: unknown) => {
      reportFailure('open developer tools failed', {
        scope: 'app-shell',
        operation: 'open-developer-tools',
        cause,
      })
    })
  }, [
    featureAvailability,
    runtime.mainWindow,
  ])`,
    FILES.appShell,
  )

  source = replaceSection(
    source,
    '  const startWindowDragging =',
    '  useApplicationCommands(',
    `  const startWindowDragging = useCallback(() => {
    if (
      !featureAvailability.isAvailable(
        'window-dragging',
      )
    ) {
      return
    }

    void runtime.mainWindow.startDragging().catch((cause: unknown) => {
      reportFailure('main window drag failed', {
        scope: 'app-shell',
        operation: 'start-window-dragging',
        cause,
      })
    })
  }, [
    featureAvailability,
    runtime.mainWindow,
  ])`,
    FILES.appShell,
  )

  if (!source.includes('degradedFeatures={failureSnapshot.degradedFeatures}')) {
    source = replaceRequired(
      source,
      `      <WorkspaceContainer
        isWindowMaximized={isWindowMaximized}`,
      `      <WorkspaceContainer
        degradedFeatures={failureSnapshot.degradedFeatures}
        isWindowMaximized={isWindowMaximized}`,
      FILES.appShell,
    )
  }

  if (!source.includes("featureAvailability.isAvailable(\n            'settings'")) {
    source = replaceRequired(
      source,
      `        open={isSettingsOpen}
        store={runtime.settings}`,
      `        open={
          isSettingsOpen &&
          featureAvailability.isAvailable(
            'settings',
          )
        }
        store={runtime.settings}`,
      FILES.appShell,
    )
  }

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.appShell + ': updated.')
}

async function rewriteWorkspace() {
  const file = resolvePath(FILES.workspace)

  let source = await readFile(file, 'utf8')

  const componentStart = '  const inspectorAvailable = useCanvasInspectorAvailability()'

  const subscriptionsEnd = '  useSyncExternalStore(port.canvases.subscribe'

  const startIndex = source.indexOf(componentStart)

  const endIndex = source.indexOf(subscriptionsEnd, startIndex)

  if (startIndex === -1 || endIndex === -1) {
    throw new Error('Could not locate WorkspaceContainer subscription section.')
  }

  const canonicalSubscriptions = `  const inspectorAvailable = useCanvasInspectorAvailability()

  const windowControlsDisabled =
    degradedFeatures.includes(
      'window-controls',
    )

  const windowDraggingDisabled =
    degradedFeatures.includes(
      'window-dragging',
    )

  const developerToolsDisabled =
    degradedFeatures.includes(
      'developer-tools',
    )

  const settingsDisabled =
    degradedFeatures.includes(
      'settings',
    )

  const workbench = useSyncExternalStore(
    port.workspace.subscribe,
    port.workspace.getSnapshot,
    port.workspace.getSnapshot,
  )

  const failureSnapshot = useSyncExternalStore(
    failureRuntime.subscribe,
    failureRuntime.getSnapshot,
    failureRuntime.getSnapshot,
  )

  useEffect(() => {
    const openSessionIds = new Set(
      workbench.tabs.flatMap(
        (tab) =>
          tab.kind === 'canvas'
            ? [tab.sessionId]
            : [],
      ),
    )

    for (
      const sessionId of
      failureSnapshot.quarantinedDocuments
    ) {
      if (
        openSessionIds.has(
          sessionId,
        )
      ) {
        continue
      }

      failureRuntime.resolveScope({
        kind: 'document',
        documentId: sessionId,
      })
    }
  }, [
    failureSnapshot.quarantinedDocuments,
    workbench.tabs,
  ])

`

  source = source.slice(0, startIndex) + canonicalSubscriptions + source.slice(endIndex)

  if (!source.includes('readonly degradedFeatures: readonly string[]')) {
    source = replaceRequired(
      source,
      `export interface WorkspaceContainerProps {
  readonly port: WorkspaceUIPort`,
      `export interface WorkspaceContainerProps {
  readonly port: WorkspaceUIPort
  readonly degradedFeatures: readonly string[]`,
      FILES.workspace,
    )
  }

  if (
    !source.includes(
      `  degradedFeatures,
  isWindowMaximized,`,
    )
  ) {
    source = replaceRequired(
      source,
      `export function WorkspaceContainer({
  port,
  isWindowMaximized,`,
      `export function WorkspaceContainer({
  port,
  degradedFeatures,
  isWindowMaximized,`,
      FILES.workspace,
    )
  }

  const oldActions = `      openCommandPalette: onCommandPaletteOpen,
      openDeveloperTools: onDeveloperToolsOpen,
      openSettingsWindow: onSettingsOpen,`

  const newActions = `      openCommandPalette: onCommandPaletteOpen,

      openDeveloperTools:
        developerToolsDisabled
          ? () => {}
          : onDeveloperToolsOpen,

      openSettingsWindow:
        settingsDisabled
          ? () => {}
          : onSettingsOpen,`

  if (source.includes(oldActions)) {
    source = source.replace(oldActions, newActions)
  }

  if (!source.includes('developerToolsDisabled,\n      handleCloseTab,')) {
    source = replaceRequired(
      source,
      `      activeEditorSession,
      handleCloseTab,`,
      `      activeEditorSession,
      developerToolsDisabled,
      handleCloseTab,`,
      FILES.workspace,
    )
  }

  if (!source.includes('settingsDisabled,\n      workbench.tabs,')) {
    source = replaceRequired(
      source,
      `      port.workspace,
      workbench.tabs,`,
      `      port.workspace,
      settingsDisabled,
      workbench.tabs,`,
      FILES.workspace,
    )
  }

  if (!source.includes('windowControlsDisabled={windowControlsDisabled}')) {
    source = replaceRequired(
      source,
      `        <DesktopTitleBar
          isMaximized={isWindowMaximized}`,
      `        <DesktopTitleBar
          isMaximized={isWindowMaximized}
          windowControlsDisabled={windowControlsDisabled}
          windowDraggingDisabled={windowDraggingDisabled}`,
      FILES.workspace,
    )
  }

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.workspace + ': updated.')
}

async function writeArchitectureCheck() {
  const source = `#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  policy:
    'apps/desktop/src/application/failures/feature-availability.ts',

  titleBar:
    'apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx',

  appShell:
    'apps/desktop/src/presentation/AppShell.tsx',

  workspace:
    'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',
}

for (
  const relativePath of
  Object.values(files)
) {
  if (
    !existsSync(
      path.join(
        ROOT,
        relativePath,
      ),
    )
  ) {
    failures.push(
      'Missing feature degradation file: ' +
        relativePath,
    )
  }
}

if (failures.length === 0) {
  const policy =
    read(files.policy)

  const titleBar =
    read(files.titleBar)

  const appShell =
    read(files.appShell)

  const workspace =
    read(files.workspace)

  requireText(
    policy,
    'createFeatureAvailability',
    'Feature availability policy is missing.',
  )

  requireText(
    appShell,
    'failureSnapshot.degradedFeatures',
    'AppShell does not consume degraded feature state.',
  )

  requireText(
    appShell,
    "'settings'",
    'Settings degradation is not enforced.',
  )

  requireText(
    appShell,
    "'developer-tools'",
    'Developer tools degradation is not enforced.',
  )

  requireText(
    workspace,
    'windowControlsDisabled',
    'Workspace does not enforce degraded window controls.',
  )

  requireText(
    workspace,
    'windowDraggingDisabled',
    'Workspace does not enforce degraded window dragging.',
  )

  requireText(
    titleBar,
    'disabled={',
    'Window buttons are not actually disabled.',
  )

  requireText(
    titleBar,
    'windowDraggingDisabled',
    'Title bar does not reject degraded dragging.',
  )

  requireOrdering(
    workspace,
    'const workbench = useSyncExternalStore(',
    'useEffect(() => {',
    'Workspace workbench must be declared before the quarantine cleanup effect.',
  )
}

if (failures.length > 0) {
  console.error(
    [
      'Feature degradation checks failed:',
      ...failures.map(
        (failure) =>
          '- ' + failure,
      ),
    ].join('\\n'),
  )

  process.exitCode = 1
} else {
  console.log(
    'Feature degradation checks passed.',
  )
}

function read(relativePath) {
  return readFileSync(
    path.join(
      ROOT,
      relativePath,
    ),
    'utf8',
  )
}

function requireText(
  source,
  expected,
  failure,
) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}

function requireOrdering(
  source,
  first,
  second,
  failure,
) {
  const firstIndex =
    source.indexOf(first)

  const secondIndex =
    source.indexOf(second)

  if (
    firstIndex === -1 ||
    secondIndex === -1 ||
    firstIndex > secondIndex
  ) {
    failures.push(failure)
  }
}
`

  await writeText(FILES.architectureCheck, source)
}

async function writeArchitectureDecision() {
  const source = `# ADR-010: Feature degradation enforcement

- Status: Accepted
- Date: 2026-07-24
- Scope: Desktop feature availability

## Context

A feature-degraded notification is not sufficient if the related control
continues invoking the failed feature.

## Decision

FailureRuntime.degradedFeatures is the source of truth for session-level feature
availability.

Settings, developer tools, native window controls and window dragging consult
that state before executing.

Window minimize and maximize buttons use native disabled semantics.

The application close button remains available even if close-request
coordination is degraded.

## Presentation

Feature degradation does not use a card, modal or global error page.

Unavailable controls use restrained disabled opacity and a short native title.

## Recovery

A feature remains unavailable after its notification disappears.

Only the owning integration may restore it by resolving the corresponding
feature scope in FailureRuntime.
`

  await writeText(FILES.adr, source)
}

async function registerArchitectureCheck() {
  const file = resolvePath(FILES.packageJson)

  const packageJson = JSON.parse(await readFile(file, 'utf8'))

  const command = 'node tests/architecture/check-feature-degradation-enforcement.mjs'

  const current = packageJson.scripts?.['test:architecture']

  if (typeof current !== 'string') {
    throw new Error('package.json is missing test:architecture.')
  }

  if (!current.includes(command)) {
    packageJson.scripts['test:architecture'] = current + ' && ' + command

    await writeFile(file, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')
  }
}

function ensureImport(source, importLine, beforeLine) {
  if (source.includes(importLine)) {
    return source
  }

  if (!source.includes(beforeLine)) {
    throw new Error('Could not locate import anchor: ' + beforeLine)
  }

  return source.replace(beforeLine, importLine + '\n' + beforeLine)
}

function replaceSection(source, startMarker, nextMarker, replacement, file) {
  const startIndex = source.indexOf(startMarker)

  const nextIndex = source.indexOf(nextMarker, startIndex)

  if (startIndex === -1 || nextIndex === -1) {
    throw new Error(['Could not replace section in', file + ':', startMarker].join(' '))
  }

  return source.slice(0, startIndex) + replacement + '\n\n' + source.slice(nextIndex)
}

function replaceRequired(source, oldText, newText, file) {
  if (source.includes(newText)) {
    return source
  }

  if (!source.includes(oldText)) {
    throw new Error(['Could not find expected text in', file + ':', oldText].join(' '))
  }

  return source.replace(oldText, newText)
}

async function writeText(relativePath, content) {
  const absolutePath = resolvePath(relativePath)

  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  })

  await writeFile(absolutePath, normalizeText(content), 'utf8')

  console.log(relativePath + ': written.')
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath)
}

main().catch((error) => {
  console.error('')
  console.error('Feature degradation refactor failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
