#!/usr/bin/env node
// Verifies that the host can build the native crates in this workspace.
//
// poietica-ai-persistence-native depends on rusqlite with the
// `bundled-sqlcipher-vendored-openssl` feature. That feature compiles both
// SQLCipher and OpenSSL from C source and links them statically, so the shipped
// binary can open an encrypted database on a machine with no OpenSSL installed.
// OpenSSL configures itself through ./Configure, a Perl script, so Perl must be
// on PATH at build time. It is not needed at run time and end users never see it.
//
// NASM is deliberately not checked: openssl-src passes `no-asm` for the
// x86_64-pc-windows-msvc target, so OpenSSL's assembly routines are never built.
//
// Commands are spawned without a shell. Both tools are real executables that
// libuv resolves through PATH, and passing an argument array together with
// `shell: true` is deprecated in Node 26 (DEP0190) because arguments would be
// concatenated rather than escaped.
//
// Exit code 0 when the host is ready, 1 otherwise.

import { spawnSync } from 'node:child_process'
import { platform } from 'node:process'

const requirements = [
  {
    command: 'perl',
    arguments: ['-v'],
    label: 'Perl',
    reason: "OpenSSL's ./Configure is a Perl script",
    install: {
      win32: [
        'winget install -e --id StrawberryPerl.StrawberryPerl',
        '  (or: scoop install perl, or download from https://strawberryperl.com)',
        '  reopen the terminal afterwards so PATH is refreshed',
      ],
      darwin: ['Perl ships with macOS; if it is missing, run: brew install perl'],
      linux: ['install your distribution package, for example: apt install perl'],
    },
  },
  {
    command: 'cargo',
    arguments: ['--version'],
    label: 'Cargo',
    reason: 'the native crates are built with Cargo',
    install: {
      win32: ['install Rust from https://rustup.rs'],
      darwin: ['install Rust from https://rustup.rs'],
      linux: ['install Rust from https://rustup.rs'],
    },
  },
]

function isAvailable(command, commandArguments) {
  const result = spawnSync(command, commandArguments, { stdio: 'ignore' })
  if (result.error) return false
  return result.status === 0
}

const missing = []

for (const requirement of requirements) {
  if (isAvailable(requirement.command, requirement.arguments)) {
    console.log(`ok      ${requirement.label}`)
  } else {
    console.log(`MISSING ${requirement.label}`)
    missing.push(requirement)
  }
}

if (missing.length === 0) {
  console.log('')
  console.log('the host can build the native crates')
  process.exit(0)
}

console.log('')
console.log('this host cannot build the native crates yet:')
for (const requirement of missing) {
  console.log('')
  console.log(`  ${requirement.label} — ${requirement.reason}`)
  const lines = requirement.install[platform] ?? requirement.install.linux
  for (const line of lines) console.log(`    ${line}`)
}
console.log('')
console.log('see docs/development/windows-build-prerequisites.md for the background')
process.exit(1)
