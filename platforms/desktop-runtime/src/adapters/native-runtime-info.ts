import { invoke } from '@poietica/desktop-ipc'

export interface NativeRuntimeInfo {
  readonly platform: string
  readonly arch: string
  readonly version: string
}

export function getRuntimeInfo(): Promise<NativeRuntimeInfo> {
  return invoke<NativeRuntimeInfo>('get_runtime_info')
}
