import type { Plugin } from 'vite'

interface UnknownRecord {
  readonly [key: string]: unknown
}

interface SerializableLocation {
  readonly file?: string
  readonly line?: number
  readonly column?: number
}

interface SerializableViteError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly plugin?: string
  readonly id?: string
  readonly frame?: string
  readonly pluginCode?: string
  readonly location?: SerializableLocation
}

interface ViteDiagnosticEvent {
  readonly source: 'vite'
  readonly occurredAt: string
  readonly error: SerializableViteError
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function getString(record: UnknownRecord, property: string): string | undefined {
  const value = record[property]
  return typeof value === 'string' ? value : undefined
}

function getNumber(record: UnknownRecord, property: string): number | undefined {
  const value = record[property]
  return typeof value === 'number' ? value : undefined
}

function serializeLocation(value: unknown): SerializableLocation | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const file = getString(value, 'file') ?? getString(value, 'id')

  const line = getNumber(value, 'line') ?? getNumber(value, 'lineNumber')

  const column = getNumber(value, 'column') ?? getNumber(value, 'columnNumber')

  if (file === undefined && line === undefined && column === undefined) {
    return undefined
  }

  return {
    file,
    line,
    column,
  }
}

function serializeViteError(value: unknown): SerializableViteError {
  if (value instanceof Error) {
    const errorRecord = value as Error & UnknownRecord

    return {
      name: value.name || 'Error',
      message: value.message || '未知 Vite 错误',
      stack: value.stack,
      plugin: getString(errorRecord, 'plugin'),
      id: getString(errorRecord, 'id'),
      frame: getString(errorRecord, 'frame'),
      pluginCode: getString(errorRecord, 'pluginCode'),
      location: serializeLocation(errorRecord.loc),
    }
  }

  if (!isRecord(value)) {
    return {
      name: 'ViteError',
      message: typeof value === 'string' ? value : String(value ?? '未知 Vite 错误'),
    }
  }

  return {
    name: getString(value, 'name') ?? 'ViteError',
    message: getString(value, 'message') ?? getString(value, 'msg') ?? '未知 Vite 错误',
    stack: getString(value, 'stack'),
    plugin: getString(value, 'plugin'),
    id: getString(value, 'id'),
    frame: getString(value, 'frame'),
    pluginCode: getString(value, 'pluginCode'),
    location: serializeLocation(value.loc),
  }
}

function isViteErrorPayload(payload: unknown): payload is UnknownRecord & {
  readonly type: 'error'
  readonly err: unknown
} {
  return isRecord(payload) && payload.type === 'error' && 'err' in payload
}

/**
 * Vite 暂时没有公开的自定义 Overlay 替换 API。
 *
 * 这里将兼容逻辑隔离在一个仅开发环境启用的插件中：
 * - 不修改 Vite 客户端源码；
 * - 不查询或删除 vite-error-overlay DOM；
 * - 不进入生产构建；
 * - 原始 Vite 错误仍正常转发给 HMR 客户端和终端；
 * - 额外发送 Poietica 自定义诊断事件。
 */
export function customErrorDiagnosticsPlugin(): Plugin {
  return {
    name: 'poietica:custom-error-diagnostics',
    apply: 'serve',
    configureServer(server) {
      const originalSend = server.ws.send.bind(server.ws)

      const sendOriginal = originalSend as (...arguments_: readonly unknown[]) => unknown

      server.ws.send = ((...arguments_: readonly unknown[]) => {
        const payload = arguments_[0]

        if (isViteErrorPayload(payload)) {
          const diagnostic: ViteDiagnosticEvent = {
            source: 'vite',
            occurredAt: new Date().toISOString(),
            error: serializeViteError(payload.err),
          }

          sendOriginal({
            type: 'custom',
            event: 'poietica:diagnostic',
            data: diagnostic,
          })
        }

        return sendOriginal(...arguments_)
      }) as typeof server.ws.send
    },
  }
}
