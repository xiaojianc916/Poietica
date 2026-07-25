import {
  type Box,
  type Editor,
  kickoutOccludedShapes,
  type TLShape,
  type TLShapePartial,
  Vec,
} from 'tldraw'

export type SelectionTransformField = 'x' | 'y' | 'width' | 'height' | 'rotation'

/*
 * What the selection permits, as opposed to where it currently is.
 *
 * Every field here is a function of which shapes are selected, their lock
 * state and their ShapeUtil capabilities. None of it changes while a drag is in
 * flight, whereas x/y/width/height/rotation change on every frame. Separating
 * the two is what lets a consumer stop recomputing the half that stood still.
 *
 * canResize is the exception that explains why the two were fused in the first
 * place: it also has to reject a degenerate bounding box, which is per-frame
 * geometry. That part is an O(1) guard applied on top, not a reason to walk the
 * selection again.
 */
export interface SelectionCapability {
  readonly isReadonly: boolean
  readonly hasLockedShape: boolean
  readonly hasMixedRotation: boolean
  readonly canMove: boolean
  readonly canResize: boolean
  readonly canRotate: boolean
  readonly hasForcedAspectRatio: boolean
}

export interface SelectionTransformSnapshot extends SelectionCapability {
  readonly count: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number | null
}

/*
 * Everything the selection itself can answer, gathered in a single walk.
 */
interface SelectionSurvey {
  readonly firstRotation: number
  readonly hasMixedRotation: boolean
  readonly hasLockedShape: boolean
  readonly allResizable: boolean
  readonly allRotatable: boolean
  readonly hasForcedAspectRatio: boolean
}

interface DerivedSelectionGeometry {
  readonly snapshot: SelectionTransformSnapshot
  readonly shapes: readonly TLShape[]
  readonly bounds: Box
  readonly sharedRotation: number | null
}

export interface CommitSelectionTransformOptions {
  readonly editor: Editor
  readonly field: SelectionTransformField
  readonly value: number
  readonly isAspectRatioLocked: boolean
}

const EPSILON = 0.000001
export const MINIMUM_SELECTION_SIZE = 0.01

/*
 * Field-wise equality for a selection snapshot.
 *
 * A snapshot is a value: thirteen numbers, booleans and nulls, all readonly.
 * But deriveSelectionGeometry hands it out as a fresh object on every
 * recomputation, so any consumer that compares by reference - which is what a
 * signal does - observes a change on every editor tick that invalidates a
 * derivation this module reads, even when nothing in the value moved. This
 * function is the value-equality half that the type always implied.
 *
 * Both operands are produced by the single object literal in
 * deriveSelectionGeometry, so they always carry the same key set and
 * iterating one of them is exhaustive. That is deliberate. A hand-written
 * chain of field comparisons goes stale the day someone adds a field to the
 * interface, and a stale equality here does not merely lose an optimisation -
 * it reports "unchanged" for a value that changed, and the status bar shows a
 * number that is no longer true. react-redux takes exactly this position in
 * shallowEqual, for exactly this reason.
 *
 * Object.keys allocates one small array per call. That is paid once per
 * recomputation and buys the removal of a full React render of the status
 * bar, so the trade is not close.
 *
 * Object.is rather than ===, so that a NaN rotation does not compare unequal
 * to itself and force a render on every single frame.
 */
export function selectionTransformSnapshotsEqual(
  left: SelectionTransformSnapshot,
  right: SelectionTransformSnapshot,
): boolean {
  const keys = Object.keys(left) as (keyof SelectionTransformSnapshot)[]

  for (const key of keys) {
    if (!Object.is(left[key], right[key])) {
      return false
    }
  }

  return true
}

export function getSelectionTransformSnapshot(editor: Editor): SelectionTransformSnapshot | null {
  return deriveSelectionGeometry(editor)?.snapshot ?? null
}

export function commitSelectionTransform({
  editor,
  field,
  value,
  isAspectRatioLocked,
}: CommitSelectionTransformOptions): boolean {
  if (!Number.isFinite(value)) {
    return false
  }

  const geometry = deriveSelectionGeometry(editor)

  if (!geometry) {
    return false
  }

  switch (field) {
    case 'x':
    case 'y':
      return commitSelectionPosition(editor, geometry, field, value)

    case 'width':
    case 'height':
      return commitSelectionSize(editor, geometry, field, value, isAspectRatioLocked)

    case 'rotation':
      return commitSelectionRotation(editor, geometry, value)
  }
}

/*
 * One walk over the selection.
 *
 * This previously took five separate walks, three of which called
 * editor.getShapeUtil(shape) independently, so every shape was looked up three
 * times on every frame of a drag. A sixth walk built a rotations array that was
 * read once for its first element and then discarded, allocating an N-element
 * array per frame for nothing.
 *
 * The three ShapeUtil predicates short-circuit individually today. Fusing them
 * means all three have to settle before the loop can stop, so the loop breaks as
 * soon as they have. In the ordinary case, where everything is resizable and
 * rotatable, the old code walked all three to completion anyway.
 */
function surveySelection(editor: Editor, shapes: TLShape[]): SelectionSurvey {
  let firstRotation: number | null = null
  let hasMixedRotation = false
  let hasLockedShape = false
  let allResizable = true
  let allRotatable = true
  let hasForcedAspectRatio = false

  for (const shape of shapes) {
    const rotation = editor.getShapePageTransform(shape)?.rotation() ?? 0

    if (firstRotation === null) {
      firstRotation = rotation
    } else if (
      !hasMixedRotation &&
      Math.abs(normalizeRadians(rotation - firstRotation)) > EPSILON
    ) {
      hasMixedRotation = true
    }

    if (shape.isLocked) {
      hasLockedShape = true
    }

    if (allResizable || allRotatable || !hasForcedAspectRatio) {
      // One lookup per shape, shared by all three capability predicates.
      const util = editor.getShapeUtil(shape)

      if (
        allResizable &&
        !(
          util.canResize(shape) &&
          util.canBeLaidOut(shape, {
            type: 'resize_to_bounds',
            shapes,
          })
        )
      ) {
        allResizable = false
      }

      if (allRotatable && util.hideRotateHandle(shape)) {
        allRotatable = false
      }

      if (!hasForcedAspectRatio && util.isAspectRatioLocked(shape)) {
        hasForcedAspectRatio = true
      }
    }
  }

  return {
    firstRotation: firstRotation ?? 0,
    hasMixedRotation,
    hasLockedShape,
    allResizable,
    allRotatable,
    hasForcedAspectRatio,
  }
}

function deriveSelectionCapability(
  editor: Editor,
  survey: SelectionSurvey,
  bounds: Box,
): SelectionCapability {
  const isReadonly = editor.getIsReadonly()

  /*
   * This used to be every((shape) => !shape.isLocked), computed with a
   * dedicated pass alongside some((shape) => shape.isLocked). The two are
   * negations of one another, so the second pass spent a full walk of the
   * selection, every frame, arriving at a boolean already in hand.
   */
  const canMove = !isReadonly && !survey.hasLockedShape

  /*
   * 混合旋转选择没有唯一的局部 X/Y 轴。
   * 在实现完整的每对象矩阵编辑器之前，不允许用一个
   * W/H 数值对混合旋转对象进行非一致缩放。
   *
   * The trailing bounds test is the one capability that depends on per-frame
   * geometry rather than on the selection. It is O(1), so it can sit on top of a
   * survey that only has to be redone when the selection itself changes.
   */
  const canResize =
    canMove &&
    !survey.hasMixedRotation &&
    survey.allResizable &&
    bounds.w > EPSILON &&
    bounds.h > EPSILON

  /*
   * rotateShapesBy 支持混合旋转的相对旋转，
   * 但底部 R 字段表达的是绝对角度。
   * 混合值没有唯一绝对角度，因此禁止编辑。
   */
  const canRotate = canMove && !survey.hasMixedRotation && survey.allRotatable

  return {
    isReadonly,
    hasLockedShape: survey.hasLockedShape,
    hasMixedRotation: survey.hasMixedRotation,
    canMove,
    canResize,
    canRotate,
    hasForcedAspectRatio: survey.hasForcedAspectRatio,
  }
}

function deriveSelectionGeometry(editor: Editor): DerivedSelectionGeometry | null {
  const shapes = editor.getSelectedShapes()

  if (shapes.length === 0) {
    return null
  }

  const pageBounds = editor.getSelectionPageBounds()

  if (!pageBounds) {
    return null
  }

  const survey = surveySelection(editor, shapes)

  const sharedRotation = survey.hasMixedRotation ? null : survey.firstRotation

  /*
   * 只有具有共同页面旋转时，旋转包围盒才具有明确的
   * W/H 和左上角语义。
   *
   * 混合旋转时退回页面轴对齐包围盒，并禁用 W/H/R
   * 的绝对编辑，避免把 getSelectionRotation() 返回的
   * 0 错误解释为真实共同旋转。
   */
  const rotatedBounds = !survey.hasMixedRotation
    ? editor.getSelectionRotatedPageBounds()
    : undefined

  const bounds = rotatedBounds ?? pageBounds

  return {
    shapes,
    bounds,
    sharedRotation,
    snapshot: {
      ...deriveSelectionCapability(editor, survey, bounds),
      count: shapes.length,
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h,
      rotation: survey.hasMixedRotation
        ? null
        : normalizeDegrees(radiansToDegrees(sharedRotation ?? 0)),
    },
  }
}

function commitSelectionPosition(
  editor: Editor,
  geometry: DerivedSelectionGeometry,
  field: 'x' | 'y',
  value: number,
): boolean {
  if (!geometry.snapshot.canMove) {
    return false
  }

  const deltaPage = new Vec(
    field === 'x' ? value - geometry.bounds.x : 0,
    field === 'y' ? value - geometry.bounds.y : 0,
  )

  if (Math.abs(deltaPage.x) < EPSILON && Math.abs(deltaPage.y) < EPSILON) {
    return false
  }

  const updates: TLShapePartial[] = geometry.shapes.map((shape) => {
    /*
     * shape.x / shape.y 属于父级局部坐标。
     * 状态栏 X/Y 属于页面坐标。
     *
     * 当父级 Frame/Group 发生旋转时，必须把页面空间
     * delta 反向旋转到父级局部空间。
     */
    const localDelta = deltaPage.clone()

    const parent = editor.getShapeParent(shape)

    if (parent) {
      const parentTransform = editor.getShapePageTransform(parent)

      if (parentTransform) {
        localDelta.rot(-parentTransform.rotation())
      }
    }

    return {
      id: shape.id,
      type: shape.type,
      x: shape.x + localDelta.x,
      y: shape.y + localDelta.y,
    }
  })

  editor.markHistoryStoppingPoint('edit selection position from status bar')

  editor.run(() => {
    editor.updateShapes(updates)

    kickoutOccludedShapes(
      editor,
      geometry.shapes.map((shape) => shape.id),
    )
  })

  return true
}

function commitSelectionSize(
  editor: Editor,
  geometry: DerivedSelectionGeometry,
  field: 'width' | 'height',
  value: number,
  isAspectRatioLocked: boolean,
): boolean {
  if (!geometry.snapshot.canResize) {
    return false
  }

  const targetValue = Math.max(value, MINIMUM_SELECTION_SIZE)

  const forcedRatio = geometry.snapshot.hasForcedAspectRatio

  const keepRatio = forcedRatio || isAspectRatioLocked

  let scaleX = 1
  let scaleY = 1

  if (field === 'width') {
    scaleX = targetValue / geometry.bounds.w

    if (keepRatio) {
      scaleY = scaleX
    }
  } else {
    scaleY = targetValue / geometry.bounds.h

    if (keepRatio) {
      scaleX = scaleY
    }
  }

  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return false
  }

  if (Math.abs(scaleX - 1) < EPSILON && Math.abs(scaleY - 1) < EPSILON) {
    return false
  }

  editor.markHistoryStoppingPoint('edit selection size from status bar')

  editor.run(() => {
    for (const shape of geometry.shapes) {
      /*
       * resizeShape 是官方 ShapeUtil resize 入口：
       * - 调用 ShapeUtil resize 生命周期；
       * - 尊重父级坐标系；
       * - 尊重自定义 ShapeUtil；
       * - 避免直接猜测 props.w / props.h。
       *
       * scaleAxisRotation 使用选择共同页面旋转，
       * scaleOrigin 使用旋转包围盒左上角。
       */
      editor.resizeShape(shape.id, new Vec(scaleX, scaleY), {
        scaleOrigin: geometry.bounds.point,
        scaleAxisRotation: geometry.sharedRotation ?? 0,
        isAspectRatioLocked: keepRatio,
        mode: 'scale_shape',
      })
    }

    kickoutOccludedShapes(
      editor,
      geometry.shapes.map((shape) => shape.id),
    )
  })

  return true
}

function commitSelectionRotation(
  editor: Editor,
  geometry: DerivedSelectionGeometry,
  targetDegrees: number,
): boolean {
  if (!geometry.snapshot.canRotate || geometry.snapshot.rotation === null) {
    return false
  }

  const targetRadians = degreesToRadians(targetDegrees)

  const currentRadians = geometry.sharedRotation ?? 0

  const delta = normalizeRadians(targetRadians - currentRadians)

  if (Math.abs(delta) < EPSILON) {
    return false
  }

  editor.markHistoryStoppingPoint('edit selection rotation from status bar')

  editor.run(() => {
    editor.rotateShapesBy(
      geometry.shapes.map((shape) => shape.id),
      delta,
    )

    kickoutOccludedShapes(
      editor,
      geometry.shapes.map((shape) => shape.id),
    )
  })

  return true
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function normalizeDegrees(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360

  return Math.abs(normalized - 360) < EPSILON ? 0 : normalized
}

function normalizeRadians(radians: number): number {
  const fullTurn = Math.PI * 2

  const normalized = ((((radians + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI

  return Object.is(normalized, -0) ? 0 : normalized
}
