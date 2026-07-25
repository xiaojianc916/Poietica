import { IpcInvocationError, isIpcError } from './error'

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/*
 * The Tauri transport is resolved once per process.
 *
 * The previous implementation evaluated `await import(...)` inside the call
 * itself. A dynamic import of an already-instantiated module still allocates
 * and returns a fresh promise, so every IPC call paid an unconditional extra
 * microtask turn plus a namespace destructuring before the request could even
 * be dispatched — for a module that cannot change after first load.
 *
 * The import stays lazy so hosts without a Tauri runtime (unit tests, tooling)
 * can import this package, but it resolves exactly once. Once warm, dispatch
 * carries no import expression at all.
 */
let transport: TauriInvoke | null = null
let pendingTransport: Promise<TauriInvoke> | null = null

function loadTransport(): Promise<TauriInvoke> {
  pendingTransport ??= import('@tauri-apps/api/core').then((module) => {
    transport = module.invoke as unknown as TauriInvoke

    return transport
  })

  return pendingTransport
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const dispatch = transport ?? (await loadTransport())

  try {
    return await dispatch<T>(cmd, args)
  } catch (error) {
    if (isIpcError(error)) {
      throw new IpcInvocationError(error)
    }

    throw error
  }
}
