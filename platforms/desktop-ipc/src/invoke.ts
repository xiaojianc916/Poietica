import { IpcInvocationError, isIpcError } from './error'

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  try {
    return await tauriInvoke<T>(cmd, args)
  } catch (error) {
    if (isIpcError(error)) {
      throw new IpcInvocationError(error)
    }
    throw error
  }
}
