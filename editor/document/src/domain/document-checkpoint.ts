import type { TLStoreSnapshot } from 'tldraw'

/**
 * A structural subset of tldraw's RecordsDiff.
 *
 * The document domain deliberately depends on the diff contract rather than
 * the Store implementation. Values remain unknown here because migration and
 * record validation belong to tldraw's schema boundary.
 */
export interface DocumentRecordChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

/**
 * Exact document state used for dirty tracking.
 *
 * Records are immutable in TLStore. Keeping references in a Map allows an
 * unchanged record to be compared in O(1), while records that were recreated
 * with equivalent data are compared structurally.
 */
export interface DocumentCheckpoint {
  readonly records: Map<string, unknown>
}

export function createDocumentCheckpoint(document: TLStoreSnapshot): DocumentCheckpoint {
  return {
    records: new Map(Object.entries(document.store)),
  }
}

export function cloneDocumentCheckpoint(checkpoint: DocumentCheckpoint): DocumentCheckpoint {
  return {
    records: new Map(checkpoint.records),
  }
}

/**
 * Applies only the records present in a Store diff.
 *
 * No full snapshot, full-document traversal or full-document serialization is
 * performed on the interaction path.
 */
export function applyDocumentChanges(
  checkpoint: DocumentCheckpoint,
  changes: DocumentRecordChanges,
): ReadonlySet<string> {
  const changedIds = new Set<string>()

  for (const [id, record] of Object.entries(changes.added)) {
    checkpoint.records.set(id, record)
    changedIds.add(id)
  }

  for (const [id, update] of Object.entries(changes.updated)) {
    checkpoint.records.set(id, update[1])
    changedIds.add(id)
  }

  for (const id of Object.keys(changes.removed)) {
    checkpoint.records.delete(id)
    changedIds.add(id)
  }

  return changedIds
}

export function reconcileDirtyRecords(
  current: DocumentCheckpoint,
  saved: DocumentCheckpoint,
  dirtyRecordIds: Set<string>,
  candidateIds: Iterable<string>,
): void {
  for (const id of candidateIds) {
    const currentHasRecord = current.records.has(id)
    const savedHasRecord = saved.records.has(id)

    if (currentHasRecord !== savedHasRecord) {
      dirtyRecordIds.add(id)
      continue
    }

    if (!currentHasRecord) {
      dirtyRecordIds.delete(id)
      continue
    }

    if (recordsEqual(current.records.get(id), saved.records.get(id))) {
      dirtyRecordIds.delete(id)
    } else {
      dirtyRecordIds.add(id)
    }
  }
}

export function rebuildDirtyRecords(
  current: DocumentCheckpoint,
  saved: DocumentCheckpoint,
  dirtyRecordIds: Set<string>,
): void {
  dirtyRecordIds.clear()

  const candidateIds = new Set([...current.records.keys(), ...saved.records.keys()])

  reconcileDirtyRecords(current, saved, dirtyRecordIds, candidateIds)
}

export function checkpointsEqual(left: DocumentCheckpoint, right: DocumentCheckpoint): boolean {
  if (left.records.size !== right.records.size) {
    return false
  }

  for (const [id, leftRecord] of left.records) {
    if (!right.records.has(id)) {
      return false
    }

    if (!recordsEqual(leftRecord, right.records.get(id))) {
      return false
    }
  }

  return true
}

function recordsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  return stableStringify(left) === stableStringify(right)
}

/**
 * Deterministic comparison remains necessary when Undo recreates a record with
 * equivalent data but a different object identity.
 *
 * Unlike the previous implementation, this function is called only for records
 * present in the current Store diff, never for the full document on every
 * pointer-driven transaction.
 */
function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)

    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null'

    case 'bigint':
      return JSON.stringify(value.toString())

    case 'undefined':
    case 'function':
    case 'symbol':
      return 'null'

    case 'object':
      break
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value

  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort((left, right) => left.localeCompare(right))

  return (
    '{' +
    keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',') +
    '}'
  )
}
