import { IpcInvocationError, isIpcError } from '@poietica/desktop-ipc'
import {
  commands,
  type NativeCrashReport as GeneratedNativeCrashReport,
} from '@poietica/desktop-ipc/generated/ipc-bindings'

/**
 * Native crash report generated from the Rust IPC contract.
 *
 * The renderer must not redefine this DTO manually. Rust and
 * tauri-specta remain the source of truth for the boundary.
 */
export type NativeCrashReport = GeneratedNativeCrashReport

/**
 * Reads and consumes the previous native process crash report.
 *
 * The Native command removes a valid report after reading it, so a
 * renderer reload cannot repeatedly present the same historical crash.
 */
export async function takePreviousNativeCrashReport(): Promise<NativeCrashReport | null> {
  try {
    return await commands.diagnosticsTakePreviousCrash()
  } catch (error: unknown) {
    if (isIpcError(error)) {
      throw new IpcInvocationError(error)
    }

    throw error
  }
}
