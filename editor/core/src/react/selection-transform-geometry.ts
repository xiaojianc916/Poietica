import {
  type Box,
  type Editor,
  kickoutOccludedShapes,
  type TLShape,
  type TLShapePartial,
  Vec,
} from 'tldraw'

export type SelectionTransformField = 'x' | 'y' | 'width' | 'height' | 'rotation'

export interface SelectionTransformSnapshot {
  readonly count: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number | null
  readonly isReadonly: boolean
  readonly hasLockedShape: boolean
  readonly hasMixedRotation: boolean
  readonly canMove: boolean
  readonly canResize: boolean
  readonly canRotate: boolean
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

function deriveSelectionGeometry(editor: Editor): DerivedSelectionGeometry | null {
  const shapes = editor.getSelectedShapes()

  if (shapes.length === 0) {
    return null
  }

  const pageBounds = editor.getSelectionPageBounds()

  if (!pageBounds) {
    return null
  }

  const rotations = shapes.map((shape) => {
    return editor.getShapePageTransform(shape)?.rotation() ?? 0
  })

  const firstRotation = rotations[0] ?? 0

  const hasMixedRotation = rotations.some(
    (rotation) => Math.abs(normalizeRadians(rotation - firstRotation)) > EPSILON,
  )

  const sharedRotation = hasMixedRotation ? null : firstRotation

  /*
   * 只有具有共同页面旋转时，旋转包围盒才具有明确的
   * W/H 和左上角语义。
   *
   * 混合旋转时退回页面轴对齐包围盒，并禁用 W/H/R
   * 的绝对编辑，避免把 getSelectionRotation() 返回的
   * 0 错误解释为真实共同旋转。
   */
  const rotatedBounds = !hasMixedRotation ? editor.getSelectionRotatedPageBounds() : undefined

  const bounds = rotatedBounds ?? pageBounds

  const isReadonly = editor.getIsReadonly()

  const hasLockedShape = shapes.some((shape) => shape.isLocked)

  const allUnlocked = shapes.every((shape) => !shape.isLocked)

  const allResizable = shapes.every((shape) => {
    const util = editor.getShapeUtil(shape)

    return (
      util.canResize(shape) &&
      util.canBeLaidOut(shape, {
        type: 'resize_to_bounds',
        shapes,
      })
    )
  })

  const allRotatable = shapes.every((shape) => !editor.getShapeUtil(shape).hideRotateHandle(shape))

  const hasForcedAspectRatio = shapes.some((shape) =>
    editor.getShapeUtil(shape).isAspectRatioLocked(shape),
  )

  const canMove = !isReadonly && allUnlocked

  /*
   * 混合旋转选择没有唯一的局部 X/Y 轴。
   * 在实现完整的每对象矩阵编辑器之前，不允许用一个
   * W/H 数值对混合旋转对象进行非一致缩放。
   */
  const canResize =
    canMove && !hasMixedRotation && allResizable && bounds.w > EPSILON && bounds.h > EPSILON

  /*
   * rotateShapesBy 支持混合旋转的相对旋转，
   * 但底部 R 字段表达的是绝对角度。
   * 混合值没有唯一绝对角度，因此禁止编辑。
   */
  const canRotate = canMove && !hasMixedRotation && allRotatable

  return {
    shapes,
    bounds,
    sharedRotation,
    snapshot: {
      count: shapes.length,
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h,
      rotation: hasMixedRotation ? null : normalizeDegrees(radiansToDegrees(sharedRotation ?? 0)),
      isReadonly,
      hasLockedShape,
      hasMixedRotation,
      canMove,
      canResize,
      canRotate,
      hasForcedAspectRatio,
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
