import {
  readFile,
} from 'node:fs/promises'
import {
  spawnSync,
} from 'node:child_process'
import process from 'node:process'
import path from 'node:path'

const ROOT = process.cwd()

const GENERATED_FILE = path.join(
  ROOT,
  'platforms/desktop-ipc/src/generated/ipc-bindings.ts',
)

const EXPORTER_FILE = path.join(
  ROOT,
  'apps/desktop/src-tauri/src/ipc/export_bindings.rs',
)

const COMMAND_FILE = path.join(
  ROOT,
  'apps/desktop/src-tauri/src/commands/diagnostics.rs',
)

async function main() {
  await verifyRustSources()

  runCommand('pnpm generate:ipc')

  await verifyGeneratedBindings()

  console.log('')
  console.log(
    'Native crash IPC bindings regenerated successfully.',
  )
}

async function verifyRustSources() {
  const exporter = await readFile(
    EXPORTER_FILE,
    'utf8',
  )

  const command = await readFile(
    COMMAND_FILE,
    'utf8',
  )

  requireText(
    exporter,
    'crate::commands::diagnostics::diagnostics_take_previous_crash',
    'The diagnostics command is missing from export_bindings.rs.',
  )

  requireText(
    exporter,
    '.typ::<NativeCrashReport>()',
    'NativeCrashReport is missing from export_bindings.rs.',
  )

  requireText(
    command,
    'pub fn diagnostics_take_previous_crash(',
    'The diagnostics command is missing or still async.',
  )

  requireText(
    command,
    'error::IpcError',
    'The diagnostics command must expose IpcError.',
  )

  requireText(
    command,
    '.map_err(Into::into)',
    'The diagnostics command must convert internal errors to IpcError.',
  )
}

async function verifyGeneratedBindings() {
  const generated = await readFile(
    GENERATED_FILE,
    'utf8',
  )

  requireText(
    generated,
    'diagnosticsTakePreviousCrash',
    [
      'IPC generation completed, but',
      'diagnosticsTakePreviousCrash was not generated.',
    ].join(' '),
  )

  requireText(
    generated,
    'export type NativeCrashReport =',
    [
      'IPC generation completed, but',
      'NativeCrashReport was not generated.',
    ].join(' '),
  )

  requireText(
    generated,
    '"diagnostics_take_previous_crash"',
    [
      'Generated bindings do not invoke',
      'diagnostics_take_previous_crash.',
    ].join(' '),
  )

  console.log('')
  console.log(
    'Verified generated command: diagnosticsTakePreviousCrash',
  )

  console.log(
    'Verified generated type: NativeCrashReport',
  )
}

function requireText(
  source,
  expected,
  message,
) {
  if (!source.includes(expected)) {
    throw new Error(message)
  }
}

function runCommand(commandLine) {
  console.log(
    'Running: ' + commandLine,
  )

  const result = spawnSync(
    commandLine,
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.signal) {
    throw new Error(
      [
        commandLine,
        'was terminated by signal',
        result.signal,
      ].join(' '),
    )
  }

  if (result.status !== 0) {
    throw new Error(
      [
        commandLine,
        'failed with exit code',
        String(result.status),
      ].join(' '),
    )
  }
}
main().catch((error) => {
  console.error('')
  console.error(
    'Native crash IPC regeneration failed.',
  )

  console.error(
    error instanceof Error
      ? error.stack ?? error.message
      : error,
  )

  process.exitCode = 1
})