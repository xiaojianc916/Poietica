#!/usr/bin/env node
/**
 * Cross-platform quality runner.
 *
 * This script intentionally stays as plain ESM:
 * - it runs before TypeScript typechecking succeeds;
 * - it has no tsx / ts-node runtime dependency;
 * - it invokes Turbo through Node instead of pnpm.cmd.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const turboCli = resolve(root, 'node_modules', 'turbo', 'bin', 'turbo')
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'

function createTask(label, command, args) {
  return {
    label,
    command,
    args,
  }
}

function turboTask(name) {
  return createTask(`Turbo ${name}`, process.execPath, [turboCli, 'run', name, '--continue=always'])
}

const modes = {
  typecheck: [turboTask('typecheck')],
  'frontend-test': [turboTask('test')],
  test: [
    turboTask('test'),
    createTask('Rust tests', cargo, ['test', '--workspace', '--all-features']),
  ],
}

function printUsage() {
  console.error('Usage: node scripts/quality/run.mjs <typecheck|frontend-test|test>')
}

function assertWorkspace() {
  if (!existsSync(resolve(root, 'package.json'))) {
    throw new Error('Run this command from the repository root.')
  }

  if (!existsSync(turboCli)) {
    throw new Error('Turbo is not installed. Run pnpm install first.')
  }
}

function execute(task) {
  return new Promise((resolveExitCode) => {
    let settled = false

    function settle(exitCode) {
      if (settled) {
        return
      }

      settled = true
      resolveExitCode(exitCode)
    }

    let child

    try {
      child = spawn(task.command, task.args, {
        stdio: 'inherit',
        windowsHide: false,
        shell: false,
      })
    } catch (error) {
      console.error(
        `Unable to start ${task.command}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      settle(1)
      return
    }

    child.once('error', (error) => {
      console.error(`Unable to start ${task.command}: ${error.message}`)
      settle(1)
    })

    child.once('exit', (code, signal) => {
      if (signal !== null) {
        console.error(`${task.label} terminated by signal: ${signal}`)
        settle(1)
        return
      }

      settle(code ?? 1)
    })
  })
}

async function main() {
  const mode = process.argv[2]
  const tasks = modes[mode]

  if (!tasks) {
    printUsage()
    process.exitCode = 1
    return
  }

  try {
    assertWorkspace()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
    return
  }

  let failed = false

  for (const task of tasks) {
    if ((await execute(task)) !== 0) {
      failed = true
    }
  }

  process.exitCode = failed ? 1 : 0
}

await main()
