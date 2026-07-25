# Windows build prerequisites

The native crates in this workspace compile C source as part of the build. On
Linux and macOS the required tools are already present, so this page is mostly
about Windows.

## What has to be installed

| Tool | Needed by | Needed at run time |
| --- | --- | --- |
| MSVC build tools | every native crate | no |
| Rust, via rustup | every native crate | no |
| Perl | OpenSSL's `./Configure` | no |

Nothing on this list is shipped to end users. These are build-time
prerequisites only.

### Perl

`poietica-ai-persistence-native` depends on `rusqlite` with the
`bundled-sqlcipher-vendored-openssl` feature. That feature compiles SQLCipher
and OpenSSL from C source and links them statically, which is what lets the
application open an encrypted database on a machine that has no OpenSSL
installed.

OpenSSL has configured itself through `./Configure` — a Perl script — for
decades. Without Perl on `PATH`, the `openssl-sys` build script fails with:

```
Error configuring OpenSSL build:
Command 'perl' not found. Is perl installed?
```

Install it once:

```powershell
winget install -e --id StrawberryPerl.StrawberryPerl
```

Then **open a new terminal** so `PATH` is refreshed, and confirm:

```powershell
perl -v
```

NASM is **not** required. `openssl-src` passes `no-asm` for the
`x86_64-pc-windows-msvc` target, so OpenSSL's assembly routines are never
built.

## Checking the host

```bash
node tests/architecture/check-native-build-prerequisites.mjs
```

The script exits non-zero and prints the install command for anything missing.

## First build is slow

The first `cargo build` or `cargo test` after a clean checkout compiles
SQLCipher and OpenSSL from C source. This is silent for several minutes and is
CPU-bound, not network-bound. The result is cached in `target/`, so later
builds do not repeat it.

## Toolchain

`rust-toolchain.toml` tracks the `stable` channel rather than an exact
version. Pinning an exact version makes rustup provision a duplicate toolchain
even when the identical compiler is already installed, and that download comes
from `static.rust-lang.org`, which no cargo registry mirror covers. The real
lower bound is `rust-version` under `[workspace.package]` in the root
`Cargo.toml`; Cargo enforces it natively and reports a readable error.
