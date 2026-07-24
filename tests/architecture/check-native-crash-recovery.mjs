#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const failures = []

const files = {
  app: 'apps/desktop/src-tauri/src/bootstrap/app.rs',
  command: 'apps/desktop/src-tauri/src/commands/diagnostics.rs',
  diagnostics: 'apps/desktop/src-tauri/src/diagnostics/mod.rs',
  exporter: 'apps/desktop/src-tauri/src/ipc/export_bindings.rs',
  generated: 'platforms/desktop-ipc/src/generated/ipc-bindings.ts',
  adapter: 'platforms/desktop-runtime/src/adapters/native-crash-report.ts',
  renderer: 'apps/desktop/src/main.tsx',
  fatalIncident: 'apps/desktop/src/fatal/fatal-incident.ts',
}

for (const relativePath of Object.values(files)) {
  if (!existsSync(path.join(ROOT, relativePath))) {
    failures.push(`Missing native crash recovery file: ${relativePath}`)
  }
}

if (failures.length === 0) {
  const app = read(files.app)
  const command = read(files.command)
  const diagnostics = read(files.diagnostics)
  const exporter = read(files.exporter)
  const generated = read(files.generated)
  const adapter = read(files.adapter)
  const renderer = read(files.renderer)
  const fatalIncident = read(files.fatalIncident)

  requireText(
    app,
    'crate::diagnostics::install(app.handle())',
    'Native panic recorder is not installed during Tauri setup.',
  )

  requireText(
    app,
    'diagnostics_take_previous_crash',
    'Native crash IPC command is not registered with Tauri.',
  )

  requireText(diagnostics, 'std::panic::set_hook', 'Native panic hook is missing.')

  requireText(diagnostics, 'Uuid::now_v7()', 'Native crash incident IDs must use UUID v7.')

  forbidText(diagnostics, 'Uuid::new_v4()', 'Native crash diagnostics still use UUID v4.')

  requireText(
    diagnostics,
    'write_report_atomically',
    'Native crash report is not written atomically.',
  )

  requireText(diagnostics, 'file.sync_all()', 'Native crash report is not flushed to disk.')

  requireText(
    command,
    'pub fn diagnostics_take_previous_crash(',
    'Native crash command must remain synchronous.',
  )

  forbidText(
    command,
    'pub async fn diagnostics_take_previous_crash(',
    'Native crash command must not be async without asynchronous work.',
  )

  requireText(
    command,
    'error::IpcError',
    'Native crash command does not expose the stable IPC error DTO.',
  )

  requireText(
    command,
    '.map_err(Into::into)',
    'Native crash command does not convert internal errors to IpcError.',
  )

  requireText(
    exporter,
    'crate::commands::diagnostics::diagnostics_take_previous_crash',
    'Native crash command is missing from the IPC exporter.',
  )

  requireText(
    exporter,
    '.typ::<NativeCrashReport>()',
    'NativeCrashReport is missing from the IPC exporter.',
  )

  requireText(
    generated,
    'async diagnosticsTakePreviousCrash()',
    'Generated IPC bindings do not contain the native crash command. Run pnpm generate:ipc.',
  )

  requireText(
    generated,
    'export type NativeCrashReport =',
    'Generated IPC bindings do not contain NativeCrashReport.',
  )

  requireText(
    adapter,
    'commands.diagnosticsTakePreviousCrash()',
    'Desktop runtime adapter does not invoke the generated crash command.',
  )

  requireText(
    adapter,
    'type NativeCrashReport as GeneratedNativeCrashReport',
    'Desktop runtime adapter manually redefines NativeCrashReport.',
  )

  requireText(
    adapter,
    'isIpcError(error)',
    'Desktop runtime adapter does not normalize IPC failures.',
  )

  requireText(
    adapter,
    'new IpcInvocationError(error)',
    'Desktop runtime adapter does not expose IpcInvocationError.',
  )

  forbidText(adapter, 'return null', 'Native crash adapter has regressed to a permanent null stub.')

  requireText(
    renderer,
    'takePreviousNativeCrashReport',
    'Renderer startup does not inspect the previous native crash.',
  )

  requireText(
    renderer,
    'FATAL_PREVIOUS_NATIVE_PROCESS_CRASH',
    'Previous native crashes are not mapped to the fatal controller.',
  )

  requireText(fatalIncident, "'native-crash'", 'FatalIncidentKind does not include native-crash.')
}

if (failures.length > 0) {
  console.error(
    [
      'Native crash recovery architecture checks failed:',
      ...failures.map((failure) => `- ${failure}`),
    ].join('\n'),
  )

  process.exitCode = 1
} else {
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function requireText(source, expected, failure) {
  if (!source.includes(expected)) {
    failures.push(failure)
  }
}

function forbidText(source, forbidden, failure) {
  if (source.includes(forbidden)) {
    failures.push(failure)
  }
}
