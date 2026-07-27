/**
 * 打开文档的脏状态跟踪。
 *
 * 唯一判据是一次内容比较：当前记录值与保存点记录值是否相等。
 *
 * 此前的判据是"自基线时刻起是否收到过 diff"。那个地基是错的，运行时证据：
 *
 *   ready 投递      { recordCount: 7 }
 *   文档 diff 到达  { added: ['document:document', 'page:page', 'user:…'] }
 *   首次脏跃迁      { id: 'document:document', before: ABSENT,
 *                     after: { gridSize: 10, name: '', meta: {} } }
 *   栈: _flushHistory @ Store.mjs:186 <- EffectScheduler <- throttle.mjs:26
 *
 * 基线建立时 store 里已经有 7 条记录，document:document 就在其中。但 tldraw 的
 * Store 把历史 diff 节流后异步冲刷，于是描述初始化的那批 diff 在基线之后才到达，
 * 把已经存在的记录重报为 added。
 *
 * 到达顺序不是因果顺序。因此任何基于时刻的判据都修不好它：布防位往前挪会漏掉
 * 真实编辑，往后挪则挪不过一个长度不确定的节流窗口，只能退化成定时器猜测。
 * source: 'user' 也拦不住——这批写入本身就是 user 来源。
 *
 * 内容比较天然免疫：重报的 after 与保存点里的值相等，直接判干净。
 *
 * 保存点表示"磁盘上的内容"，所以它只在两个时刻被整体替换：打开文档，以及一次
 * 保存成功提交。两处都是 O(N)，且都与已有成本同阶——保存本身要把整份文档
 * JSON.stringify。除此之外跟踪规模只与未保存的工作量成正比：divergent 仅保存
 * 与保存点不同的记录，回到保存点值的记录立即移出。
 *
 * 撤销可能以不同的对象标识重建出等价数据，所以比较是结构性的，脏状态精确而非
 * 保守。
 *
 * tldraw 撤销栈打保存标记的方案仍然不可行，理由未变：HistoryManager 只暴露
 * getNumUndos 与 getNumRedos，撤销一次再做一次不同的编辑会让深度回到保存点的值，
 * 而文档已经不同。那会把改过的文档报成干净的，丢工作。
 */

/**
 * tldraw RecordsDiff 的结构子集。
 *
 * 文档域依赖 diff 契约而不是 Store 实现。值保持 unknown：迁移与记录校验属于
 * tldraw 的 schema 边界。
 */
export interface DocumentRecordChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

/** 记录不存在的标记，使创建与删除成为普通的值变化。 */
const ABSENT = Symbol('document-record-absent')

export interface DocumentDirtyLedger {
  /** 用一份完整记录声明保存点。文档随即是干净的。 */
  readonly setSavePoint: (records: Readonly<Record<string, unknown>>) => void

  /** 折入一批 store diff。代价与 diff 成正比，与文档规模无关。 */
  readonly apply: (changes: DocumentRecordChanges) => void

  /** 声明"正在写入磁盘的那份记录"，由调用方传入它已经捕获的快照。 */
  readonly openSaveWindow: (savedRecords: Readonly<Record<string, unknown>>) => void

  /** 待定保存点晋升为保存点。 */
  readonly commitSaveWindow: () => void

  /** 放弃待定保存点；原保存点依然成立。 */
  readonly discardSaveWindow: () => void

  readonly isDirty: () => boolean
}

export function createDocumentDirtyLedger(): DocumentDirtyLedger {
  /** 保存点的完整记录，即磁盘上的内容。 */
  let savePoint = new Map<string, unknown>()

  /** 与保存点不同的记录及其当前值。规模与未保存工作量成正比。 */
  const divergent = new Map<string, unknown>()

  /** beginSave 交出的、正在写盘的那份记录；提交后成为新的保存点。 */
  let pendingSavePoint: Map<string, unknown> | null = null

  function toRecordMap(records: Readonly<Record<string, unknown>>): Map<string, unknown> {
    return new Map(Object.entries(records))
  }

  function savedValueOf(id: string): unknown {
    return savePoint.has(id) ? savePoint.get(id) : ABSENT
  }

  /** 用一次内容比较决定这条记录是否偏离保存点。 */
  function reconcile(id: string, value: unknown): void {
    if (recordsEqual(savedValueOf(id), value)) {
      divergent.delete(id)
      return
    }

    divergent.set(id, value)
  }

  return {
    setSavePoint(records) {
      savePoint = toRecordMap(records)
      divergent.clear()
      pendingSavePoint = null
    },

    apply(changes) {
      for (const id in changes.added) {
        if (Object.hasOwn(changes.added, id)) {
          reconcile(id, changes.added[id])
        }
      }

      for (const id in changes.updated) {
        if (!Object.hasOwn(changes.updated, id)) {
          continue
        }

        const update = changes.updated[id]

        if (update) {
          reconcile(id, update[1])
        }
      }

      for (const id in changes.removed) {
        if (Object.hasOwn(changes.removed, id)) {
          reconcile(id, ABSENT)
        }
      }
    },

    openSaveWindow(savedRecords) {
      pendingSavePoint = toRecordMap(savedRecords)
    },

    commitSaveWindow() {
      if (!pendingSavePoint) {
        throw new Error('DOCUMENT_LEDGER_NO_PENDING_SAVE_POINT')
      }

      savePoint = pendingSavePoint
      pendingSavePoint = null

      /*
       * 保存点整体换成了刚写入磁盘的那份内容，所以只需要把仍在 divergent 里的
       * 记录按新保存点重新核对一遍。窗口期间未被触碰的记录，其值已经在新保存点
       * 里，核对后自然移出。代价与并发编辑量成正比。
       */
      for (const [id, value] of [...divergent]) {
        reconcile(id, value)
      }
    },

    discardSaveWindow() {
      /* 保存点没有移动，divergent 全程都是相对它维护的，已经正确。 */
      pendingSavePoint = null
    },

    isDirty() {
      return divergent.size > 0
    },
  }
}

/**
 * 结构比较，无分配，遇到第一个差异即短路。ABSENT 按标识比较，因此记录的创建与
 * 删除落在同一条代码路径上。
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

/** 显式存在的 undefined 值等同于键不存在。 */
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
