import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  runtime: 'apps/desktop/src/fatal/fatal-runtime.ts',

  collectors: 'apps/desktop/src/fatal/fatal-collectors.ts',

  boundary: 'apps/desktop/src/fatal/FatalErrorBoundary.tsx',

  reactRoot: 'apps/desktop/src/bootstrap/react-root.tsx',

  main: 'apps/desktop/src/main.tsx',

  architectureCheck: 'tests/architecture/check-fatal-escalation-policy.mjs',

  adr: 'docs/adr/ADR-006-fatal-escalation-policy.md',
})

async function main() {
  await assertRepository()

  await rewriteFatalRuntime()
  await rewriteCollectors()
  await rewriteReactBoundary()
  await rewriteReactRoot()
  await rewriteMainEntry()
  await writeArchitectureCheck()
  await writeArchitectureDecision()
  await registerArchitectureCheck()

  console.log('')
  console.log('Fatal escalation policy refactor applied.')
}

async function assertRepository() {
  const source = await readFile(resolvePath(FILES.packageJson), 'utf8')

  const packageJson = JSON.parse(source)

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error('Run this script from the Hybrid Canvas repository root.')
  }
}

async function rewriteFatalRuntime() {
  const source = [
    'import {',
    '  FatalIncidentController,',
    "} from './fatal-controller'",
    'import type {',
    '  CreateFatalIncidentInput,',
    '  FatalIncident,',
    "} from './fatal-incident'",
    '',
    '/**',
    ' * Fatal escalation is deliberately restricted to process-wide failure.',
    ' *',
    ' * Recoverable, feature-degraded and document-scoped failures must not',
    ' * enter the global fatal state machine.',
    ' */',
    'export type FatalEscalationImpact =',
    "  | 'application-fatal'",
    "  | 'native-fatal'",
    '',
    'export interface FatalEscalationInput',
    '  extends CreateFatalIncidentInput {',
    '  readonly impact: FatalEscalationImpact',
    '}',
    '',
    'export const fatalIncidentController =',
    '  new FatalIncidentController()',
    '',
    '/**',
    ' * The only production gateway allowed to enter terminal fatal state.',
    ' */',
    'export function reportFatalIncident(',
    '  input: FatalEscalationInput,',
    '): FatalIncident {',
    '  const {',
    '    impact,',
    '    ...incidentInput',
    '  } = input',
    '',
    '  return fatalIncidentController.report({',
    '    ...incidentInput,',
    '    context: {',
    '      ...(incidentInput.context ?? {}),',
    '      failureImpact: impact,',
    '    },',
    '  })',
    '}',
    '',
    'let reactFatalHostMounted = false',
    '',
    'export function markReactFatalHostMounted(): void {',
    '  reactFatalHostMounted = true',
    '}',
    '',
    'export function isReactFatalHostMounted(): boolean {',
    '  return reactFatalHostMounted',
    '}',
    '',
  ].join('\n')

  await writeText(FILES.runtime, source)
}

async function rewriteCollectors() {
  const file = resolvePath(FILES.collectors)

  let source = await readFile(file, 'utf8')

  source = replaceRequired(
    source,
    "import { fatalIncidentController, isReactFatalHostMounted } from './fatal-runtime'",
    [
      'import {',
      '  isReactFatalHostMounted,',
      '  reportFatalIncident,',
      "} from './fatal-runtime'",
    ].join('\n'),
    FILES.collectors,
  )

  const oldCall = 'const incident = fatalIncidentController.report(input)'

  const newCall = [
    'const incident = reportFatalIncident({',
    '    ...input,',
    "    impact: 'application-fatal',",
    '  })',
  ].join('\n')

  source = replaceAllRequired(source, oldCall, newCall, 3, FILES.collectors)

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.collectors + ': updated.')
}

async function rewriteReactBoundary() {
  const file = resolvePath(FILES.boundary)

  let source = await readFile(file, 'utf8')

  source = replaceRequired(
    source,
    "import { fatalIncidentController } from './fatal-runtime'",
    "import { reportFatalIncident } from './fatal-runtime'",
    FILES.boundary,
  )

  source = replaceRequired(
    source,
    'fatalIncidentController.report({',
    ['reportFatalIncident({', "      impact: 'application-fatal',"].join('\n'),
    FILES.boundary,
  )

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.boundary + ': updated.')
}

async function rewriteReactRoot() {
  const file = resolvePath(FILES.reactRoot)

  let source = await readFile(file, 'utf8')

  source = replaceRequired(
    source,
    [
      'import {',
      '  fatalIncidentController,',
      '  markReactFatalHostMounted,',
      "} from '../fatal/fatal-runtime'",
    ].join('\n'),
    [
      'import {',
      '  markReactFatalHostMounted,',
      '  reportFatalIncident,',
      "} from '../fatal/fatal-runtime'",
    ].join('\n'),
    FILES.reactRoot,
    ["import { fatalIncidentController, markReactFatalHostMounted } from '../fatal/fatal-runtime'"],
  )

  source = replaceRequired(
    source,
    'fatalIncidentController.report({',
    ['reportFatalIncident({', "      impact: 'application-fatal',"].join('\n'),
    FILES.reactRoot,
  )

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.reactRoot + ': updated.')
}

async function rewriteMainEntry() {
  const file = resolvePath(FILES.main)

  let source = await readFile(file, 'utf8')

  source = replaceRequired(
    source,
    "import { fatalIncidentController } from './fatal/fatal-runtime'",
    "import { reportFatalIncident } from './fatal/fatal-runtime'",
    FILES.main,
  )

  source = replaceRequired(
    source,
    'fatalIncidentController.report({',
    ['reportFatalIncident({', "    impact: 'native-fatal',"].join('\n'),
    FILES.main,
  )

  await writeFile(file, normalizeText(source), 'utf8')

  console.log(FILES.main + ': updated.')
}

async function writeArchitectureCheck() {
  const source = [
    '#!/usr/bin/env node',
    '',
    'import {',
    '  existsSync,',
    '  readFileSync,',
    '  readdirSync,',
    "} from 'node:fs'",
    "import path from 'node:path'",
    "import process from 'node:process'",
    '',
    'const ROOT = process.cwd()',
    'const failures = []',
    '',
    "const sourceRoot = 'apps/desktop/src'",
    '',
    'const files = {',
    "  runtime: 'apps/desktop/src/fatal/fatal-runtime.ts',",
    "  collectors: 'apps/desktop/src/fatal/fatal-collectors.ts',",
    "  boundary: 'apps/desktop/src/fatal/FatalErrorBoundary.tsx',",
    "  reactRoot: 'apps/desktop/src/bootstrap/react-root.tsx',",
    "  main: 'apps/desktop/src/main.tsx',",
    '}',
    '',
    'for (const relativePath of Object.values(files)) {',
    '  if (!existsSync(path.join(ROOT, relativePath))) {',
    '    failures.push(',
    "      'Missing fatal escalation policy file: ' +",
    '        relativePath,',
    '    )',
    '  }',
    '}',
    '',
    'if (failures.length === 0) {',
    '  const runtime = read(files.runtime)',
    '  const collectors = read(files.collectors)',
    '  const boundary = read(files.boundary)',
    '  const reactRoot = read(files.reactRoot)',
    '  const main = read(files.main)',
    '',
    '  requireText(',
    '    runtime,',
    '    "export type FatalEscalationImpact =",',
    "    'Fatal escalation impact type is missing.',",
    '  )',
    '',
    '  requireText(',
    '    runtime,',
    '    "| \'application-fatal\'",',
    "    'Application-fatal impact is missing.',",
    '  )',
    '',
    '  requireText(',
    '    runtime,',
    '    "| \'native-fatal\'",',
    "    'Native-fatal impact is missing.',",
    '  )',
    '',
    '  requireText(',
    '    runtime,',
    "    'export function reportFatalIncident(',",
    "    'Fatal escalation gateway is missing.',",
    '  )',
    '',
    '  requireText(',
    '    runtime,',
    "    'failureImpact: impact',",
    "    'Fatal incidents do not preserve their escalation impact.',",
    '  )',
    '',
    '  requireText(',
    '    collectors,',
    '    "impact: \'application-fatal\'",',
    "    'Global browser collectors do not declare application-fatal impact.',",
    '  )',
    '',
    '  requireText(',
    '    boundary,',
    '    "impact: \'application-fatal\'",',
    "    'React root boundary does not declare application-fatal impact.',",
    '  )',
    '',
    '  requireText(',
    '    reactRoot,',
    '    "impact: \'application-fatal\'",',
    "    'Runtime construction failure does not declare application-fatal impact.',",
    '  )',
    '',
    '  requireText(',
    '    main,',
    '    "impact: \'native-fatal\'",',
    "    'Previous native crash does not declare native-fatal impact.',",
    '  )',
    '',
    '  findDirectControllerReports()',
    '}',
    '',
    'if (failures.length > 0) {',
    '  console.error(',
    '    [',
    "      'Fatal escalation policy checks failed:',",
    '      ...failures.map(',
    "        (failure) => '- ' + failure,",
    '      ),',
    "    ].join('\\n'),",
    '  )',
    '',
    '  process.exitCode = 1',
    '} else {',
    '  console.log(',
    "    'Fatal escalation policy checks passed.',",
    '  )',
    '}',
    '',
    'function findDirectControllerReports() {',
    '  const allowed = new Set([',
    "    'apps/desktop/src/fatal/fatal-runtime.ts',",
    "    'apps/desktop/src/fatal/fatal-controller.ts',",
    '  ])',
    '',
    '  for (const relativePath of walk(sourceRoot)) {',
    '    if (',
    "      !relativePath.endsWith('.ts') &&",
    "      !relativePath.endsWith('.tsx')",
    '    ) {',
    '      continue',
    '    }',
    '',
    '    if (',
    "      relativePath.endsWith('.test.ts') ||",
    "      relativePath.endsWith('.test.tsx') ||",
    '      allowed.has(relativePath)',
    '    ) {',
    '      continue',
    '    }',
    '',
    '    const source = read(relativePath)',
    '',
    '    if (',
    '      source.includes(',
    "        'fatalIncidentController.report(',",
    '      )',
    '    ) {',
    '      failures.push(',
    '        [',
    "          'Direct fatal controller report is forbidden:',",
    "          relativePath + '.',",
    "          'Use reportFatalIncident with an explicit impact.',",
    "        ].join(' '),",
    '      )',
    '    }',
    '  }',
    '}',
    '',
    'function walk(relativeDirectory) {',
    '  const result = []',
    '',
    '  for (const entry of readdirSync(',
    '    path.join(ROOT, relativeDirectory),',
    '    { withFileTypes: true },',
    '  )) {',
    '    const relativePath = path.posix.join(',
    '      relativeDirectory,',
    '      entry.name,',
    '    )',
    '',
    '    if (entry.isDirectory()) {',
    '      result.push(...walk(relativePath))',
    '      continue',
    '    }',
    '',
    '    result.push(relativePath)',
    '  }',
    '',
    '  return result',
    '}',
    '',
    'function read(relativePath) {',
    '  return readFileSync(',
    '    path.join(ROOT, relativePath),',
    "    'utf8',",
    '  )',
    '}',
    '',
    'function requireText(',
    '  source,',
    '  expected,',
    '  failure,',
    ') {',
    '  if (!source.includes(expected)) {',
    '    failures.push(failure)',
    '  }',
    '}',
    '',
  ].join('\n')

  await writeText(FILES.architectureCheck, source)
}

async function writeArchitectureDecision() {
  const source = [
    '# ADR-006: Explicit fatal escalation policy',
    '',
    '- Status: Accepted',
    '- Date: 2026-07-24',
    '- Scope: Desktop renderer and native crash recovery',
    '',
    '## Context',
    '',
    'A unified fatal screen is not sufficient by itself. The application also',
    'needs a strict policy controlling which failures may enter terminal fatal',
    'state.',
    '',
    'Without an explicit escalation boundary, a recoverable document, settings,',
    'resource or optional-feature failure can accidentally replace the entire',
    'application with the global fatal UI.',
    '',
    '## Decision',
    '',
    'Production code must not call `FatalIncidentController.report` directly.',
    '',
    'All production escalation passes through `reportFatalIncident` and declares',
    'one of these impacts:',
    '',
    '- `application-fatal`: the renderer cannot safely continue;',
    '- `native-fatal`: the native process previously terminated unexpectedly.',
    '',
    'The gateway records the selected impact in fatal diagnostic context.',
    '',
    'The controller remains responsible only for terminal state, fingerprint',
    'deduplication and listener notification. It does not infer severity from',
    'arbitrary error messages.',
    '',
    '## Non-fatal failures',
    '',
    'The following failures must not use the fatal escalation gateway:',
    '',
    '- expected file open, save, cancel or conflict errors;',
    '- settings read or write failures;',
    '- recoverable IPC errors;',
    '- image, font, media and other resource loading failures;',
    '- optional feature and plugin failures;',
    '- document-scoped validation and import errors.',
    '',
    'These failures must remain within their owning application or presentation',
    'boundary.',
    '',
    '## Fatal sources',
    '',
    'Current approved fatal sources are:',
    '',
    '- bootstrap runtime construction failure;',
    '- uncaught browser ErrorEvent;',
    '- unhandled Promise rejection;',
    '- root React render failure;',
    '- Vite development compilation failure;',
    '- previous native process panic.',
    '',
    'Adding another fatal source requires an explicit impact and an architecture',
    'check update.',
    '',
    '## Consequences',
    '',
    '- accidental global escalation becomes harder;',
    '- incident diagnostics show why a failure was promoted;',
    '- the terminal state machine remains independent from browser and React;',
    '- recoverable failures need their own local handling;',
    '- architecture checks reject direct controller reports.',
    '',
  ].join('\n')

  await writeText(FILES.adr, source)
}

async function registerArchitectureCheck() {
  const file = resolvePath(FILES.packageJson)

  const source = await readFile(file, 'utf8')

  const packageJson = JSON.parse(source)

  const command = 'node tests/architecture/check-fatal-escalation-policy.mjs'

  const current = packageJson.scripts?.['test:architecture']

  if (typeof current !== 'string') {
    throw new Error('package.json is missing test:architecture.')
  }

  if (current.includes(command)) {
    console.log('Fatal escalation architecture check is already registered.')

    return
  }

  packageJson.scripts['test:architecture'] = current + ' && ' + command

  await writeFile(file, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

  console.log('Registered fatal escalation architecture check.')
}

function replaceRequired(source, oldText, newText, file, alternatives = []) {
  if (source.includes(newText)) {
    return source
  }

  if (source.includes(oldText)) {
    return source.replace(oldText, newText)
  }

  for (const alternative of alternatives) {
    if (source.includes(alternative)) {
      return source.replace(alternative, newText)
    }
  }

  throw new Error(['Could not find expected text in', file + ':', oldText].join(' '))
}

function replaceAllRequired(source, oldText, newText, expectedCount, file) {
  if (!source.includes(oldText) && source.includes(newText)) {
    return source
  }

  const count = source.split(oldText).length - 1

  if (count !== expectedCount) {
    throw new Error(
      [
        'Expected',
        String(expectedCount),
        'occurrences in',
        file + ',',
        'but found',
        String(count) + '.',
      ].join(' '),
    )
  }

  return source.replaceAll(oldText, newText)
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
  console.error('Fatal escalation policy refactor failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
