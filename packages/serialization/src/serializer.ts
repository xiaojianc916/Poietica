import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'

/**
 * 序列化的边界就是信任的边界。
 *
 * 之前这里是 `JSON.parse(raw)` 直接返回，`Serializer<T>` 的 T 纯属声明：
 * 磁盘上被改过一个字节、或者读到的是上一个版本的 envelope，都会静默地
 * 变成一个形状不对的对象往上游走。envelope 造得出来却从来没人验过。
 *
 * 所以序列化器由 schema 驱动：格式、版本、载荷一次校验通过，否则拒绝。
 */
export class SerializationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    // cause 是 ES2022 原生的 Error 选项，不需要自己再挂一个同名字段。
    super(message, options)
    this.name = 'SerializationError'
  }
}

export interface SerializationEnvelope<T = unknown> {
  readonly format: string
  readonly version: number
  readonly payload: T
  readonly serializedAt: string
  readonly envelopeId: string
}

export interface Serializer<T> {
  readonly format: string
  readonly version: number
  serialize(value: T): string
  deserialize(raw: string): T
}

const ENVELOPE_SHAPE = {
  format: v.string(),
  version: v.number(),
  serializedAt: v.pipe(v.string(), v.isoTimestamp()),
  envelopeId: v.pipe(v.string(), v.uuid()),
}

export function createSerializer<TSchema extends v.GenericSchema>(
  format: string,
  version: number,
  payload: TSchema,
): Serializer<v.InferOutput<TSchema>> {
  // v.object 默认剥掉未知键，所以旧版本多带的字段不会污染上游。
  const envelope = v.object({ ...ENVELOPE_SHAPE, payload })

  return {
    format,
    version,

    serialize(value) {
      return JSON.stringify({
        format,
        version,
        payload: value,
        serializedAt: new Date().toISOString(),
        envelopeId: uuidv7(),
      } satisfies SerializationEnvelope<v.InferOutput<TSchema>>)
    },

    deserialize(raw) {
      let parsed: unknown

      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        throw new SerializationError(`${format} payload is not valid JSON.`, { cause })
      }

      const result = v.safeParse(envelope, parsed)

      if (!result.success) {
        throw new SerializationError(`${format} envelope failed validation.`, {
          cause: result.issues,
        })
      }

      /*
       * 格式或版本对不上是「这份数据不属于这个序列化器」，不是校验细节问题。
       * 分开报，是为了让调用方能区分「需要迁移」和「数据坏了」。
       */
      if (result.output.format !== format || result.output.version !== version) {
        throw new SerializationError(
          `Expected ${format} v${version}, found ${result.output.format} v${result.output.version}.`,
        )
      }

      return result.output.payload
    },
  }
}
