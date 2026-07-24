// refactor-native-crash-ipc.mjs
//
// 目标：
// 1. 删除 Native Crash Adapter 的永久 return null 桩实现。
// 2. 接入由 tauri-specta 生成的 diagnosticsTakePreviousCrash 命令。
// 3. 统一 IPC 错误转换。
// 4. 强化架构检查，防止以后再次退化成空实现。
// 5. 不手动修改生成的 ipc-bindings.ts。

import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const FILES = Object.freeze({
  packageJson: 'package.json',

  rustCommand:
    'apps/desktop/src-tauri/src/commands/diagnostics.rs',

  rustExporter:
    'apps/desktop/src-tauri/src/ipc/export_bindings.rs',

  adapter:
    'platforms/desktop-runtime/src/adapters/native-crash-report.ts',

  generatedBindings:
    'platforms/desktop-ipc/src/generated/ipc-bindings.ts',

  architectureCheck:
    'tests/architecture/check-native-crash-recovery.mjs',
})

async function main() {
  await assertRepository()
  await assertRustCommand()
  await assertRustExporter()

  await writeNativeCrashAdapter()
  await writeArchitectureCheck()
  await registerArchitectureCheck()

  console.log('')
  console.log(
    'Native crash IPC adapter refactor applied.',
  )
  console.log('')
  console.log(
    'IMPORTANT: ipc-bindings.ts is generated code.',
  )
  console.log(
    'Run pnpm generate:ipc before typecheck.',
  )
}

async function assertRepository() {
  const source = await readFile(
    resolvePath(FILES.packageJson),
    'utf8',
  )

  const packageJson = JSON.parse(source)

  if (
    packageJson.name !==
    'hybrid-canvas'
  ) {
    throw new Error(
      'Run this script from the Hybrid Canvas repository root.',
    )
  }
}

async function assertRustCommand() {
  const source = await readFile(
    resolvePath(FILES.rustCommand),
    'utf8',
  )

  const requirements = [
    {
      text: '#[tauri::command]',
      message:
        'The diagnostics command is missing #[tauri::command].',
    },
    {
      text: '#[specta::specta]',
      message:
        'The diagnostics command is missing #[specta::specta].',
    },
    {
      text:
        'pub fn diagnostics_take_previous_crash(',
      message:
        'diagnostics_take_previous_crash must be a synchronous command.',
    },
    {
      text: 'error::IpcError',
      message:
        'The diagnostics command must return IpcError across IPC.',
    },
    {
      text: '.map_err(Into::into)',
      message:
        'The diagnostics command must convert the internal Error to IpcError.',
    },
  ]

  for (const requirement of requirements) {
    if (
      !source.includes(
        requirement.text,
      )
    ) {
      throw new Error(
        requirement.message,
      )
    }
  }

  if (
    source.includes(
      'pub async fn diagnostics_take_previous_crash(',
    )
  ) {
    throw new Error(
      'diagnostics_take_previous_crash is still async.',
    )
  }
}

async function assertRustExporter() {
  const source = await readFile(
    resolvePath(FILES.rustExporter),
    'utf8',
  )

  if (
    !source.includes(
      'crate::commands::diagnostics::diagnostics_take_previous_crash',
    )
  ) {
    throw new Error(
      [
        'The diagnostics command is not registered in the',
        'tauri-specta binding exporter.',
      ].join(' '),
    )
  }

  if (
    !source.includes(
      '.typ::<NativeCrashReport>()',
    )
  ) {
    throw new Error(
      'NativeCrashReport is not registered in the binding exporter.',
    )
  }
}

async function writeNativeCrashAdapter() {
  const source = [
    "import {",
    "  IpcInvocationError,",
    "  isIpcError,",
    "} from '@hybrid-canvas/desktop-ipc'",
    "import {",
    "  commands,",
    "  type NativeCrashReport as GeneratedNativeCrashReport,",
    "} from '@hybrid-canvas/desktop-ipc/generated/ipc-bindings'",
    "",
    "/**",
    " * Native crash report generated from the Rust IPC contract.",
    " *",
    " * The renderer must not redefine this DTO manually. Rust and",
    " * tauri-specta remain the source of truth for the boundary.",
    " */",
    "export type NativeCrashReport =",
    "  GeneratedNativeCrashReport",
    "",
    "/**",
    " * Reads and consumes the previous native process crash report.",
    " *",
    " * The Native command removes a valid report after reading it, so a",
    " * renderer reload cannot repeatedly present the same historical crash.",
    " */",
    "export async function takePreviousNativeCrashReport(): Promise<",
    "  NativeCrashReport | null",
    "> {",
    "  try {",
    "    return await commands.diagnosticsTakePreviousCrash()",
    "  } catch (error: unknown) {",
    "    if (isIpcError(error)) {",
    "      throw new IpcInvocationError(error)",
    "    }",
    "",
    "    throw error",
    "  }",
    "}",
    "",
  ].join('\n')

  await writeText(
    FILES.adapter,
    source,
  )
}

async function writeArchitectureCheck() {
  const source = [
    '#!/usr/bin/env node',
    '',
    'import {',
    '  existsSync,',
    '  readFileSync,',
    "} from 'node:fs'",
    "import path from 'node:path'",
    "import process from 'node:process'",
    '',
    'const ROOT = process.cwd()',
    'const failures = []',
    '',
    'const files = {',
    "  app: 'apps/desktop/src-tauri/src/bootstrap/app.rs',",
    "  command: 'apps/desktop/src-tauri/src/commands/diagnostics.rs',",
    "  diagnostics: 'apps/desktop/src-tauri/src/diagnostics/mod.rs',",
    "  exporter: 'apps/desktop/src-tauri/src/ipc/export_bindings.rs',",
    "  generated: 'platforms/desktop-ipc/src/generated/ipc-bindings.ts',",
    "  adapter: 'platforms/desktop-runtime/src/adapters/native-crash-report.ts',",
    "  renderer: 'apps/desktop/src/main.tsx',",
    "  fatalIncident: 'apps/desktop/src/fatal/fatal-incident.ts',",
    '}',
    '',
    'for (const relativePath of Object.values(files)) {',
    '  if (!existsSync(path.join(ROOT, relativePath))) {',
    '    failures.push(',
    "      'Missing native crash recovery file: ' +",
    '        relativePath,',
    '    )',
    '  }',
    '}',
    '',
    'if (failures.length === 0) {',
    '  const app = read(files.app)',
    '  const command = read(files.command)',
    '  const diagnostics = read(files.diagnostics)',
    '  const exporter = read(files.exporter)',
    '  const generated = read(files.generated)',
    '  const adapter = read(files.adapter)',
    '  const renderer = read(files.renderer)',
    '  const fatalIncident = read(files.fatalIncident)',
    '',
    '  requireText(',
    '    app,',
    "    'crate::diagnostics::install(app.handle())',",
    "    'Native panic recorder is not installed during Tauri setup.',",
    '  )',
    '',
    '  requireText(',
    '    app,',
    "    'diagnostics_take_previous_crash',",
    "    'Native crash IPC command is not registered with Tauri.',",
    '  )',
    '',
    '  requireText(',
    '    diagnostics,',
    "    'std::panic::set_hook',",
    "    'Native panic hook is missing.',",
    '  )',
    '',
    '  requireText(',
    '    diagnostics,',
    "    'Uuid::now_v7()',",
    "    'Native crash incident IDs must use UUID v7.',",
    '  )',
    '',
    '  forbidText(',
    '    diagnostics,',
    "    'Uuid::new_v4()',",
    "    'Native crash diagnostics still use UUID v4.',",
    '  )',
    '',
    '  requireText(',
    '    diagnostics,',
    "    'write_report_atomically',",
    "    'Native crash report is not written atomically.',",
    '  )',
    '',
    '  requireText(',
    '    diagnostics,',
    "    'file.sync_all()',",
    "    'Native crash report is not flushed to disk.',",
    '  )',
    '',
    '  requireText(',
    '    command,',
    "    'pub fn diagnostics_take_previous_crash(',",
    "    'Native crash command must remain synchronous.',",
    '  )',
    '',
    '  forbidText(',
    '    command,',
    "    'pub async fn diagnostics_take_previous_crash(',",
    "    'Native crash command must not be async without asynchronous work.',",
    '  )',
    '',
    '  requireText(',
    '    command,',
    "    'error::IpcError',",
    "    'Native crash command does not expose the stable IPC error DTO.',",
    '  )',
    '',
    '  requireText(',
    '    command,',
    "    '.map_err(Into::into)',",
    "    'Native crash command does not convert internal errors to IpcError.',",
    '  )',
    '',
    '  requireText(',
    '    exporter,',
    "    'crate::commands::diagnostics::diagnostics_take_previous_crash',",
    "    'Native crash command is missing from the IPC exporter.',",
    '  )',
    '',
    '  requireText(',
    '    exporter,',
    "    '.typ::<NativeCrashReport>()',",
    "    'NativeCrashReport is missing from the IPC exporter.',",
    '  )',
    '',
    '  requireText(',
    '    generated,',
    "    'async diagnosticsTakePreviousCrash()',",
    "    'Generated IPC bindings do not contain the native crash command. Run pnpm generate:ipc.',",
    '  )',
    '',
    '  requireText(',
    '    generated,',
    "    'export type NativeCrashReport =',",
    "    'Generated IPC bindings do not contain NativeCrashReport.',",
    '  )',
    '',
    '  requireText(',
    '    adapter,',
    "    \"commands.diagnosticsTakePreviousCrash()\",",
    "    'Desktop runtime adapter does not invoke the generated crash command.',",
    '  )',
    '',
    '  requireText(',
    '    adapter,',
    "    'type NativeCrashReport as GeneratedNativeCrashReport',",
    "    'Desktop runtime adapter manually redefines NativeCrashReport.',",
    '  )',
    '',
    '  requireText(',
    '    adapter,',
    "    'isIpcError(error)',",
    "    'Desktop runtime adapter does not normalize IPC failures.',",
    '  )',
    '',
    '  requireText(',
    '    adapter,',
    "    'new IpcInvocationError(error)',",
    "    'Desktop runtime adapter does not expose IpcInvocationError.',",
    '  )',
    '',
    '  forbidText(',
    '    adapter,',
    "    'return null',",
    "    'Native crash adapter has regressed to a permanent null stub.',",
    '  )',
    '',
    '  requireText(',
    '    renderer,',
    "    'takePreviousNativeCrashReport',",
    "    'Renderer startup does not inspect the previous native crash.',",
    '  )',
    '',
    '  requireText(',
    '    renderer,',
    "    'FATAL_PREVIOUS_NATIVE_PROCESS_CRASH',",
    "    'Previous native crashes are not mapped to the fatal controller.',",
    '  )',
    '',
    '  requireText(',
    '    fatalIncident,',
    "    \"'native-crash'\",",
    "    'FatalIncidentKind does not include native-crash.',",
    '  )',
    '}',
    '',
    'if (failures.length > 0) {',
    '  console.error(',
    '    [',
    "      'Native crash recovery architecture checks failed:',",
    '      ...failures.map(',
    "        (failure) => '- ' + failure,",
    '      ),',
    "    ].join('\\n'),",
    '  )',
    '',
    '  process.exitCode = 1',
    '} else {',
    '  console.log(',
    "    'Native crash recovery architecture checks passed.',",
    '  )',
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
    'function forbidText(',
    '  source,',
    '  forbidden,',
    '  failure,',
    ') {',
    '  if (source.includes(forbidden)) {',
    '    failures.push(failure)',
    '  }',
    '}',
    '',
  ].join('\n')

  await writeText(
    FILES.architectureCheck,
    source,
  )
}

async function registerArchitectureCheck() {
  const packagePath = resolvePath(
    FILES.packageJson,
  )

  const source = await readFile(
    packagePath,
    'utf8',
  )

  const packageJson = JSON.parse(source)

  const command =
    'node tests/architecture/check-native-crash-recovery.mjs'

  const current =
    packageJson.scripts?.[
      'test:architecture'
    ]

  if (typeof current !== 'string') {
    throw new Error(
      'package.json is missing test:architecture.',
    )
  }

  if (current.includes(command)) {
    console.log(
      'Native crash architecture check is already registered.',
    )

    return
  }

  packageJson.scripts[
    'test:architecture'
  ] = current + ' && ' + command

  await writeFile(
    packagePath,
    JSON.stringify(
      packageJson,
      null,
      2,
    ) + '\n',
    'utf8',
  )

  console.log(
    'Registered native crash architecture check.',
  )
}

async function writeText(
  relativePath,
  content,
) {
  const absolutePath =
    resolvePath(relativePath)

  await mkdir(
    path.dirname(absolutePath),
    {
      recursive: true,
    },
  )

  await writeFile(
    absolutePath,
    normalizeText(content),
    'utf8',
  )

  console.log(
    relativePath + ': written.',
  )
}

function normalizeText(source) {
  return (
    source
      .replace(/\r\n/g, '\n')
      .trimEnd() + '\n'
  )
}

function resolvePath(relativePath) {
  return path.join(
    ROOT,
    relativePath,
  )
}

main().catch((error) => {
  console.error('')
  console.error(
    'Native crash IPC refactor failed.',
  )

  console.error(
    error instanceof Error
      ? error.stack ?? error.message
      : error,
  )

  process.exitCode = 1
})