export type Result<T, E> = Ok<T> | Err<E>

export interface Ok<T> {
  readonly _tag: 'Ok'
  readonly value: T
}

export interface Err<E> {
  readonly _tag: 'Err'
  readonly error: E
}

export function ok<T>(value: T): Ok<T> {
  return { _tag: 'Ok', value }
}

export function err<E>(error: E): Err<E> {
  return { _tag: 'Err', error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result._tag === 'Ok'
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result._tag === 'Err'
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result._tag === 'Ok') {
    return result.value
  }
  throw new Error(`Called unwrap on Err: ${JSON.stringify(result.error)}`)
}

export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (result._tag === 'Err') {
    return result.error
  }
  throw new Error(`Called unwrapErr on Ok: ${JSON.stringify(result.value)}`)
}

export function map<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result._tag === 'Ok' ? ok(fn(result.value)) : result
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result._tag === 'Err' ? err(fn(result.error)) : result
}

export function flatMap<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result._tag === 'Ok' ? fn(result.value) : result
}

export function match<T, E, R>(
  result: Result<T, E>,
  onOk: (value: T) => R,
  onErr: (error: E) => R,
): R {
  return result._tag === 'Ok' ? onOk(result.value) : onErr(result.error)
}

export function fromThrowable<T, E>(fn: () => T, onError: (error: unknown) => E): Result<T, E> {
  try {
    return ok(fn())
  } catch (e) {
    return err(onError(e))
  }
}

export async function fromPromise<T, E>(
  promise: Promise<T>,
  onError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise)
  } catch (e) {
    return err(onError(e))
  }
}

export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (r._tag === 'Err') {
      return r
    }
    values.push(r.value)
  }
  return ok(values)
}

export function firstOk<T, E>(results: readonly Result<T, E>[]): Result<T, E> {
  if (results.length === 0) {
    return err(undefined as E)
  }
  for (const r of results) {
    if (r._tag === 'Ok') {
      return r
    }
  }
  const last = results.at(-1)

  return last?._tag === 'Err' ? last : err(undefined as E)
}
