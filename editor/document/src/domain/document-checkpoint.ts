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
  const records = checkpoint.records

  /*
   * Diff containers are iterated by key. Object.entries / Object.values
   * materialise an intermediate array on every store transaction, which on the
   * pointer-driven path means one allocation per container per frame.
   */
  for (const id in changes.added) {
    if (!Object.hasOwn(changes.added, id)) {
      continue
    }

    records.set(id, changes.added[id])
    changedIds.add(id)
  }

  for (const id in changes.updated) {
    if (!Object.hasOwn(changes.updated, id)) {
      continue
    }

    const update = changes.updated[id]

    if (!update) {
      continue
    }

    records.set(id, update[1])
    changedIds.add(id)
  }

  for (const id in changes.removed) {
    if (!Object.hasOwn(changes.removed, id)) {
      continue
    }

    records.delete(id)
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

/**
 * Structural record comparison.
 *
 * Undo can recreate a record carrying equivalent data under a different object
 * identity, so reference equality alone is not sufficient for dirty tracking.
 * The comparison therefore walks the value graph directly.
 *
 * The previous implementation compared two canonical strings produced by a
 * hand-written serialiser. That approach was rejected for two reasons.
 *
 * Cost: it allocated a key array, a filtered array, a sorted array, a mapped
 * array and a joined string at every level of every record, twice per
 * comparison, on a path that runs once per pointer-driven transaction.
 *
 * Correctness: key ordering was established with String.prototype.localeCompare,
 * which resolves against the host ICU locale. The canonical form was therefore
 * not stable across machines, despite the function's name.
 *
 * This comparison allocates nothing and short-circuits on the first difference.
 */
function recordsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (typeof left !== 'object' || left === null) {
    return false
  }

  if (typeof right !== 'object' || right === null) {
    return false
  }

  const leftIsArray = Array.isArray(left)

  if (leftIsArray !== Array.isArray(right)) {
    return false
  }

  if (leftIsArray) {
    const leftArray = left as readonly unknown[]
    const rightArray = right as readonly unknown[]

    if (leftArray.length !== rightArray.length) {
      return false
    }

    for (let index = 0; index < leftArray.length; index += 1) {
      if (!recordsEqual(leftArray[index], rightArray[index])) {
        return false
      }
    }

    return true
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>

  /*
   * An explicitly present `undefined` value is treated as an absent key, which
   * preserves the semantics of the serialiser this replaced.
   */
  let leftDefinedKeys = 0

  for (const key in leftRecord) {
    if (!Object.hasOwn(leftRecord, key)) {
      continue
    }

    const leftValue = leftRecord[key]

    if (leftValue === undefined) {
      continue
    }

    leftDefinedKeys += 1

    if (!recordsEqual(leftValue, rightRecord[key])) {
      return false
    }
  }

  let rightDefinedKeys = 0

  for (const key in rightRecord) {
    if (Object.hasOwn(rightRecord, key) && rightRecord[key] !== undefined) {
      rightDefinedKeys += 1
    }
  }

  return leftDefinedKeys === rightDefinedKeys
}
