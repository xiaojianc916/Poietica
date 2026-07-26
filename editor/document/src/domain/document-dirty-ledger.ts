/**
 * Dirty tracking for an open document.
 *
 * This replaces a pair of full-document checkpoints. That design kept two
 * Maps mirroring every record in the store — one for the current document and
 * one for the last saved document — for the entire lifetime of an open
 * document, in order to answer a single boolean. Every save additionally
 * rebuilt both Maps from a fresh snapshot and ran a structural comparison over
 * the whole document.
 *
 * The store diff already carries, for every record it touches, both the value
 * before the change and the value after it. That is sufficient. The ledger
 * lazily records the value each touched record held at the last save point and
 * compares only those records. A document that has just been saved holds no
 * entries at all.
 *
 * Undo can recreate a record carrying equivalent data under a different object
 * identity, so a record that returns to its saved value is detected
 * structurally and drops out of the ledger. Dirty state therefore remains
 * exact, not conservative.
 *
 * A save marker on tldraw's undo stack was considered and rejected. tldraw's
 * HistoryManager keeps its stacks private and exposes only getNumUndos and
 * getNumRedos, and its history interceptor clears the redo stack on any new
 * user edit. Stack depth therefore does not identify a document state: undoing
 * once and then making a different edit returns the depth to its value at the
 * save point while leaving the document different. That failure mode reports a
 * modified document as clean, which loses work.
 */

/**
 * A structural subset of tldraw's RecordsDiff.
 *
 * The document domain depends on the diff contract rather than on the Store
 * implementation. Values stay unknown here because migration and record
 * validation belong to tldraw's schema boundary.
 */
export interface DocumentRecordChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

/**
 * Marks the absence of a record, so that creation and deletion are ordinary
 * value transitions rather than special cases.
 */
const ABSENT = Symbol('document-record-absent')

export interface DocumentDirtyLedger {
  /** Folds one store diff into the ledger. Cost is linear in the diff, not in the document. */
  readonly apply: (changes: DocumentRecordChanges) => void

  /** Declares the current document state as the pending save point. */
  readonly openSaveWindow: () => void

  /** Promotes the pending save point to the save point. */
  readonly commitSaveWindow: () => void

  /** Abandons the pending save point; the previous save point still stands. */
  readonly discardSaveWindow: () => void

  /** Declares the current document state clean with no history. */
  readonly reset: () => void

  readonly isDirty: () => boolean
}

export function createDocumentDirtyLedger(): DocumentDirtyLedger {
  /** Value held at the save point, recorded on first touch, for touched records only. */
  const baseline = new Map<string, unknown>()
  const dirty = new Set<string>()

  /** Value held at the moment openSaveWindow was called, for records touched since. */
  const pendingBaseline = new Map<string, unknown>()
  const pendingCurrent = new Map<string, unknown>()
  let saveWindowOpen = false

  function touch(id: string, before: unknown, after: unknown): void {
    if (!baseline.has(id)) {
      baseline.set(id, before)
    }

    if (recordsEqual(baseline.get(id), after)) {
      /*
       * The record is back at its saved value, so it stops being tracked. This
       * is what keeps the ledger's footprint proportional to genuine unsaved
       * work rather than to session length.
       */
      baseline.delete(id)
      dirty.delete(id)
    } else {
      dirty.add(id)
    }

    if (saveWindowOpen) {
      if (!pendingBaseline.has(id)) {
        pendingBaseline.set(id, before)
      }

      pendingCurrent.set(id, after)
    }
  }

  function closeSaveWindow(): void {
    saveWindowOpen = false
    pendingBaseline.clear()
    pendingCurrent.clear()
  }

  return {
    apply(changes) {
      for (const id in changes.added) {
        if (Object.hasOwn(changes.added, id)) {
          touch(id, ABSENT, changes.added[id])
        }
      }

      for (const id in changes.updated) {
        if (!Object.hasOwn(changes.updated, id)) {
          continue
        }

        const update = changes.updated[id]

        if (!update) {
          continue
        }

        touch(id, update[0], update[1])
      }

      for (const id in changes.removed) {
        if (Object.hasOwn(changes.removed, id)) {
          touch(id, changes.removed[id], ABSENT)
        }
      }
    },

    openSaveWindow() {
      closeSaveWindow()
      saveWindowOpen = true
    },

    commitSaveWindow() {
      /*
       * Persistence accepted the document as it stood when the window opened.
       * Every record untouched since then is clean by construction. The only
       * candidates are the records the window recorded, so the new save point
       * is established in time linear in concurrent edits — and in constant
       * time when there were none.
       */
      baseline.clear()
      dirty.clear()

      for (const [id, valueAtSavePoint] of pendingBaseline) {
        if (!recordsEqual(valueAtSavePoint, pendingCurrent.get(id))) {
          baseline.set(id, valueAtSavePoint)
          dirty.add(id)
        }
      }

      closeSaveWindow()
    },

    discardSaveWindow() {
      /*
       * The save point did not move. baseline and dirty were maintained
       * against it throughout the window, so they are already correct.
       */
      closeSaveWindow()
    },

    reset() {
      baseline.clear()
      dirty.clear()
      closeSaveWindow()
    },

    isDirty() {
      return dirty.size > 0
    },
  }
}

/**
 * Structural comparison, allocation-free and short-circuiting on the first
 * difference. The ABSENT marker compares by identity, so record creation and
 * deletion fall out of the same code path.
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

  return leftIsArray
    ? arraysEqual(left as readonly unknown[], right as readonly unknown[])
    : objectsEqual(left as Record<string, unknown>, right as Record<string, unknown>)
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!recordsEqual(left[index], right[index])) {
      return false
    }
  }

  return true
}

/** An explicitly present `undefined` value is treated as an absent key. */
function objectsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  let leftDefinedKeys = 0

  for (const key in left) {
    if (!Object.hasOwn(left, key)) {
      continue
    }

    const leftValue = left[key]

    if (leftValue === undefined) {
      continue
    }

    leftDefinedKeys += 1

    if (!recordsEqual(leftValue, right[key])) {
      return false
    }
  }

  let rightDefinedKeys = 0

  for (const key in right) {
    if (Object.hasOwn(right, key) && right[key] !== undefined) {
      rightDefinedKeys += 1
    }
  }

  return leftDefinedKeys === rightDefinedKeys
}
