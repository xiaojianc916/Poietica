import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  surface: 'apps/desktop/src/presentation/workspace/DocumentQuarantineSurface.tsx',

  workspace: 'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  feedback: 'apps/desktop/src/presentation/ui/ui-feedback.tsx',

  architectureCheck: 'tests/architecture/check-failure-presentation-hierarchy.mjs',

  adr: 'docs/adr/ADR-009-failure-presentation-hierarchy.md',
})

async function main() {
  await assertRepository()
  await assertPreviousRefactor()

  await rewriteDocumentQuarantineSurface()
  await updateWorkspaceIntegration()
  await removeDocumentFatalToast()
  await writeArchitectureCheck()
  await writeArchitectureDecision()
  await registerArchitectureCheck()

  console.log('')
  console.log('Lightweight document failure presentation applied.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function assertPreviousRefactor() {
  const workspace = await readFile(resolvePath(FILES.workspace), 'utf8')

  if (!workspace.includes('DocumentQuarantineSurface')) {
    throw new Error(
      [
        'Document isolation is not installed.',
        'Apply the document failure isolation refactor first.',
      ].join(' '),
    )
  }

  const feedback = await readFile(resolvePath(FILES.feedback), 'utf8')

  if (!feedback.includes('failureRuntime')) {
    throw new Error('The structured FailureRuntime is not installed.')
  }
}

async function rewriteDocumentQuarantineSurface() {
  const source = `import { DangerTriangle } from '@mynaui/icons-react'
import {
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { failureRuntime } from '../../application/failures/failure-runtime'

export interface DocumentQuarantineSurfaceProps {
  readonly sessionId: string
  readonly onClose: () => void
}

export function DocumentQuarantineSurface({
  sessionId,
  onClose,
}: DocumentQuarantineSurfaceProps) {
  const snapshot =
    useSyncExternalStore(
      failureRuntime.subscribe,
      failureRuntime.getSnapshot,
      failureRuntime.getSnapshot,
    )

  const [copyState, setCopyState] =
    useState<
      'idle' | 'copied' | 'failed'
    >('idle')

  const failureEntry =
    snapshot.failures.find(
      (entry) =>
        entry.failure.impact ===
          'document-fatal' &&
        entry.failure.scope.kind ===
          'document' &&
        entry.failure.scope
          .documentId === sessionId,
    )

  const diagnostic = useMemo(
    () =>
      formatDocumentDiagnostic(
        sessionId,
        failureEntry?.failure,
      ),
    [
      failureEntry?.failure,
      sessionId,
    ],
  )

  const copyDiagnostic =
    async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(
          diagnostic,
        )

        setCopyState('copied')
      } catch {
        setCopyState('failed')
      }
    }

  return (
    <section
      aria-label="当前画布不可用"
      aria-live="assertive"
      className={[
        'grid size-full',
        'place-items-center',
        'px-6 py-10',
      ].join(' ')}
      role="alert"
    >
      <div
        className={[
          'flex w-full',
          'max-w-md',
          'items-start gap-3',
        ].join(' ')}
      >
        <DangerTriangle
          aria-hidden="true"
          className={[
            'mt-0.5 size-5',
            'shrink-0',
            'text-destructive',
          ].join(' ')}
        />

        <div
          className={[
            'min-w-0 flex-1',
            'grid gap-3',
          ].join(' ')}
        >
          <div className="grid gap-1">
            <h1
              className={[
                'text-base',
                'font-medium',
                'tracking-tight',
              ].join(' ')}
            >
              此画布暂时无法继续
            </h1>

            <p
              className={[
                'text-sm leading-6',
                'text-muted-foreground',
              ].join(' ')}
            >
              为保护其他画布，当前画布已停止运行。
              其他画布不受影响。
            </p>
          </div>

          <div
            className={[
              'flex flex-wrap',
              'items-center gap-x-4',
              'gap-y-2',
            ].join(' ')}
          >
            <button
              className={[
                'text-sm font-medium',
                'text-foreground',
                'underline-offset-4',
                'hover:underline',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={onClose}
              type="button"
            >
              关闭画布
            </button>

            <button
              className={[
                'text-sm',
                'text-muted-foreground',
                'underline-offset-4',
                'hover:text-foreground',
                'hover:underline',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={() => {
                void copyDiagnostic()
              }}
              type="button"
            >
              {copyState === 'copied'
                ? '已复制诊断信息'
                : copyState ===
                    'failed'
                  ? '复制失败'
                  : '复制诊断信息'}
            </button>
          </div>

          <p
            className={[
              'text-xs',
              'text-muted-foreground/70',
            ].join(' ')}
          >
            {failureEntry?.failure.code ??
              'DOCUMENT_EDITOR_SESSION_FATAL'}
          </p>
        </div>
      </div>
    </section>
  )
}

function formatDocumentDiagnostic(
  sessionId: string,
  failure:
    | {
        readonly id: string
        readonly code: string
        readonly occurredAt: string
        readonly technicalMessage: string
        readonly context: Readonly<
          Record<string, unknown>
        >
      }
    | undefined,
): string {
  if (!failure) {
    return [
      'Hybrid Canvas Document Failure',
      '',
      'Session ID: ' + sessionId,
      '错误码: DOCUMENT_EDITOR_SESSION_FATAL',
      '错误信息: Document session was quarantined.',
    ].join('\\n')
  }

  const stack = readContextText(
    failure.context,
    'stack',
  )

  const componentStack =
    readContextText(
      failure.context,
      'componentStack',
    )

  return [
    'Hybrid Canvas Document Failure',
    '',
    'Failure ID: ' + failure.id,
    'Session ID: ' + sessionId,
    '时间: ' + failure.occurredAt,
    '错误码: ' + failure.code,
    '影响范围: document-fatal',
    '错误信息: ' +
      failure.technicalMessage,
    stack
      ? '\\nJavaScript Stack:\\n' +
        stack
      : undefined,
    componentStack
      ? '\\nReact Component Stack:\\n' +
        componentStack
      : undefined,
  ]
    .filter(
      (
        value,
      ): value is string =>
        typeof value === 'string' &&
        value.length > 0,
    )
    .join('\\n')
}

function readContextText(
  context: Readonly<
    Record<string, unknown>
  >,
  key: string,
): string | undefined {
  const value = context[key]

  return typeof value === 'string' &&
    value.length > 0
    ? value
    : undefined
}
`

  await writeText(FILES.surface, source)
}

async function updateWorkspaceIntegration() {
  const file = resolvePath(FILES.workspace)

  let source = await readFile(file, 'utf8')

  source = replaceRequired(
    source,
    "import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'",
    "import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'",
    FILES.workspace,
  )

  const failureSnapshotBlock = `  const failureSnapshot = useSyncExternalStore(
    failureRuntime.subscribe,
    failureRuntime.getSnapshot,
    failureRuntime.getSnapshot,
  )`

  const cleanupBlock = `${failureSnapshotBlock}

  useEffect(() => {
    const openSessionIds =
      new Set(
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
  ])`

  source = replaceRequired(source, failureSnapshotBlock, cleanupBlock, FILES.workspace)

  source = replaceRequired(
    source,
    `<DocumentQuarantineSurface
        onClose={() => {`,
    `<DocumentQuarantineSurface
        sessionId={sessionId}
        onClose={() => {`,
    FILES.workspace,
  )

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.workspace + ': updated.')
}

async function removeDocumentFatalToast() {
  const file = resolvePath(FILES.feedback)

  let source = await readFile(file, 'utf8')

  source = replaceRequired(
    source,
    '  const visible = snapshot.failures.slice(-3)',
    `  const visible =
    snapshot.failures
      .filter(
        (entry) =>
          entry.failure.impact !==
          'document-fatal',
      )
      .slice(-3)`,
    FILES.feedback,
  )

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.feedback + ': updated.')
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
  surface:
    'apps/desktop/src/presentation/workspace/DocumentQuarantineSurface.tsx',

  workspace:
    'apps/desktop/src/presentation/workspace/WorkspaceContainer.tsx',

  feedback:
    'apps/desktop/src/presentation/ui/ui-feedback.tsx',
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
      'Missing failure presentation file: ' +
        relativePath,
    )
  }
}

if (failures.length === 0) {
  const surface =
    read(files.surface)

  const workspace =
    read(files.workspace)

  const feedback =
    read(files.feedback)

  requireText(
    surface,
    '此画布暂时无法继续',
    'Document isolation message is missing.',
  )

  requireText(
    surface,
    '其他画布不受影响',
    'Document isolation does not explain its limited scope.',
  )

  requireText(
    surface,
    '复制诊断信息',
    'Document isolation cannot copy diagnostics.',
  )

  requireText(
    surface,
    'size-5',
    'Document isolation icon is not restrained.',
  )

  forbidText(
    surface,
    'rounded-lg',
    'Document isolation must not use a large card.',
  )

  forbidText(
    surface,
    'rounded-xl',
    'Document isolation must not use a large card.',
  )

  forbidText(
    surface,
    'shadow-xl',
    'Document isolation must not use a floating card shadow.',
  )

  forbidText(
    surface,
    'shadow-2xl',
    'Document isolation must not use a floating card shadow.',
  )

  forbidText(
    surface,
    'bg-destructive/10',
    'Document isolation icon must not use a large warning badge.',
  )

  requireText(
    feedback,
    "entry.failure.impact !==\\n          'document-fatal'",
    'Document fatal failures are still rendered as toast.',
  )

  requireText(
    workspace,
    'sessionId={sessionId}',
    'Document isolation surface does not receive its session identity.',
  )

  requireText(
    workspace,
    'failureRuntime.resolveScope({',
    'Closed documents do not clear quarantine ownership.',
  )
}

if (failures.length > 0) {
  console.error(
    [
      'Failure presentation hierarchy checks failed:',
      ...failures.map(
        (failure) =>
          '- ' + failure,
      ),
    ].join('\\n'),
  )

  process.exitCode = 1
} else {
  console.log(
    'Failure presentation hierarchy checks passed.',
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

function forbidText(
  source,
  forbidden,
  failure,
) {
  if (source.includes(forbidden)) {
    failures.push(failure)
  }
}
`

  await writeText(FILES.architectureCheck, source)
}

async function writeArchitectureDecision() {
  const source = `# ADR-009: Failure presentation hierarchy

- Status: Accepted
- Date: 2026-07-24
- Scope: Recoverable, degraded, document and application failure presentation

## Decision

Failure impact determines presentation scope.

Recoverable failures use temporary toast feedback.

Feature degradation may use one temporary notification, but the owning control
must retain its disabled or degraded state independently from the toast.

Document fatal does not use toast as its primary presentation. It replaces only
the failed document editor with a lightweight inline unavailable state.

Application fatal and native fatal use the unified full-window fatal surface.

## Document isolation visual rules

The document unavailable state is not a card, dialog or global error page.

It must not use:

- large warning illustrations;
- card backgrounds;
- elevated shadows;
- thick borders;
- full-window overlays;
- expanded diagnostic stacks by default.

It uses:

- one restrained 20 to 24 pixel icon;
- one short title;
- one short scope explanation;
- lightweight text actions;
- an unobtrusive error code.

The application title bar, tabs, sidebars and other documents remain usable.

## Diagnostic action

Document diagnostic information is copied on demand. Technical details are not
displayed by default inside the editor surface.

## Lifecycle

Dismissing a toast never resolves document quarantine.

Document quarantine is cleared only after the owning document session is no
longer present in the workspace.
`

  await writeText(FILES.adr, source)
}

async function registerArchitectureCheck() {
  const file = resolvePath(FILES.packageJson)

  const packageJson = JSON.parse(await readFile(file, 'utf8'))

  const command = 'node tests/architecture/check-failure-presentation-hierarchy.mjs'

  const current = packageJson.scripts?.['test:architecture']

  if (typeof current !== 'string') {
    throw new Error('package.json is missing test:architecture.')
  }

  if (!current.includes(command)) {
    packageJson.scripts['test:architecture'] = current + ' && ' + command

    await writeFile(file, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')
  }
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
  console.error('Lightweight failure presentation refactor failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
