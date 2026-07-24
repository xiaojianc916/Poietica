import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  coordinator: 'apps/desktop/src/application/failures/failure-coordinator.ts',

  preReact: 'apps/desktop/src/fatal/pre-react-entry.ts',

  architectureCheck: 'tests/architecture/check-failure-architecture-convergence.mjs',
})

async function main() {
  await assertRepository()

  await repairFailureSnapshotReferences()
  await rewritePreReactEntry()
  await repairArchitectureCheck()
  await verifyRepair()

  console.log('')
  console.log('Failure convergence repair completed.')
}

async function assertRepository() {
  const packageJson = JSON.parse(await readFile(resolvePath(FILES.packageJson), 'utf8'))

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function repairFailureSnapshotReferences() {
  const sourceRoot = resolvePath('apps/desktop/src')

  const files = await collectSourceFiles(sourceRoot)

  for (const file of files) {
    let source = await readFile(file, 'utf8')

    const original = source

    source = source.replaceAll('snapshot.incidents', 'snapshot.failures')

    source = source.replaceAll('this.snapshot.incidents', 'this.snapshot.failures')

    if (file.endsWith(path.normalize(FILES.coordinator))) {
      source = source.replace('  type FailureImpact,\n', '')
    }

    if (source !== original) {
      await writeFile(file, normalizeText(source), 'utf8')

      console.log(relativePath(file) + ': repaired.')
    }
  }
}

async function rewritePreReactEntry() {
  const source = `import {
  failureCoordinator,
  type FailureIncident,
} from '../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'
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

    const snapshot =
      failureCoordinator.getSnapshot()

    if (!snapshot.terminal) {
      return
    }

    renderPreReactFatalScreen(
      snapshot.terminal.incident,
    )
  },
)

function renderPreReactFatalScreen(
  incident: FailureIncident,
): void {
  const root =
    document.getElementById(
      'root',
    )

  if (!root) {
    console.error(
      '[Hybrid Canvas] Root element unavailable',
      incident,
    )

    return
  }

  const diagnostic =
    formatFailureDiagnostic(
      incident,
    )

  root.replaceChildren(
    createFatalSurface(
      incident,
      diagnostic,
    ),
  )
}

function createFatalSurface(
  incident: FailureIncident,
  diagnostic: string,
): HTMLElement {
  const main =
    document.createElement(
      'main',
    )

  main.className =
    'fatal-surface'

  main.setAttribute(
    'role',
    'alert',
  )

  main.setAttribute(
    'aria-live',
    'assertive',
  )

  const content =
    document.createElement(
      'section',
    )

  content.className =
    'fatal-content'

  const icon =
    document.createElement(
      'div',
    )

  icon.className =
    'fatal-icon'

  icon.setAttribute(
    'aria-hidden',
    'true',
  )

  icon.innerHTML =
    createWarningIcon()

  const title =
    document.createElement(
      'h1',
    )

  title.className =
    'fatal-title'

  title.textContent =
    incident.impact ===
    'native-fatal'
      ? '应用上次异常终止'
      : '应用遇到严重错误'

  const description =
    document.createElement(
      'p',
    )

  description.className =
    'fatal-description'

  description.textContent =
    incident.userMessage

  const summary =
    document.createElement(
      'p',
    )

  summary.className =
    'fatal-summary'

  summary.textContent =
    incident.code +
    ' · ' +
    incident.id

  const details =
    document.createElement(
      'details',
    )

  details.className =
    'fatal-details'

  const detailsSummary =
    document.createElement(
      'summary',
    )

  detailsSummary.textContent =
    '查看诊断信息'

  const pre =
    document.createElement(
      'pre',
    )

  pre.className =
    'fatal-diagnostic'

  pre.textContent =
    diagnostic

  details.append(
    detailsSummary,
    pre,
  )

  const actions =
    document.createElement(
      'div',
    )

  actions.className =
    'fatal-actions'

  const reloadButton =
    document.createElement(
      'button',
    )

  reloadButton.className =
    'fatal-button fatal-button-primary'

  reloadButton.type =
    'button'

  reloadButton.textContent =
    '重新加载'

  reloadButton.onclick =
    () => {
      window.location.reload()
    }

  const copyButton =
    document.createElement(
      'button',
    )

  copyButton.className =
    'fatal-button'

  copyButton.type =
    'button'

  copyButton.textContent =
    '复制诊断信息'

  copyButton.onclick =
    async () => {
      try {
        await navigator.clipboard.writeText(
          diagnostic,
        )

        copyButton.textContent =
          '已复制'
      } catch {
        copyButton.textContent =
          '复制失败，请手动选择'

        details.open = true
      }
    }

  actions.append(
    reloadButton,
    copyButton,
  )

  content.append(
    icon,
    title,
    description,
    summary,
    actions,
    details,
  )

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
`

  await writeFile(resolvePath(FILES.preReact), normalizeText(source), 'utf8')

  console.log(FILES.preReact + ': rewritten.')
}

async function repairArchitectureCheck() {
  const file = resolvePath(FILES.architectureCheck)

  let source = await readFile(file, 'utf8')

  source = source.replace(/\s*'ClassifiedFailure',\r?\n/g, '\n')

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.architectureCheck + ': repaired.')
}

async function verifyRepair() {
  const sourceRoot = resolvePath('apps/desktop/src')

  const files = await collectSourceFiles(sourceRoot)

  const violations = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')

    if (source.includes('snapshot.incidents')) {
      violations.push(relativePath(file) + ': snapshot.incidents')
    }

    if (source.includes('this.snapshot.incidents')) {
      violations.push(relativePath(file) + ': this.snapshot.incidents')
    }

    if (source.includes("from './fatal-incident'")) {
      violations.push(relativePath(file) + ': legacy fatal-incident import')
    }

    if (source.includes('fatalIncidentController')) {
      violations.push(relativePath(file) + ': legacy fatal controller')
    }
  }

  const coordinator = await readFile(resolvePath(FILES.coordinator), 'utf8')

  for (const required of [
    'readonly failures:',
    'this.snapshot.failures',
    'failures: Object.freeze([...snapshot.failures])',
  ]) {
    if (!coordinator.includes(required)) {
      violations.push(FILES.coordinator + ': missing ' + required)
    }
  }

  if (violations.length > 0) {
    throw new Error(
      ['Repair verification failed:', ...violations.map((violation) => '- ' + violation)].join(
        '\n',
      ),
    )
  }
}

async function collectSourceFiles(directory) {
  const result = []

  for (const entry of await readdir(directory, {
    withFileTypes: true,
  })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      result.push(...(await collectSourceFiles(entryPath)))

      continue
    }

    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      result.push(entryPath)
    }
  }

  return result
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

function relativePath(absolutePath) {
  return path.relative(ROOT, absolutePath).replaceAll(path.sep, '/')
}

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath)
}

main().catch((error) => {
  console.error('')
  console.error('Failure convergence repair failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
