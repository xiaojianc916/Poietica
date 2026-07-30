import {
  type Box,
  type Editor,
  kickoutOccludedShapes,
  type TLShape,
  type TLShapeId,
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
 * 字段清单在编译期定死。
 *
 * satisfies Record<keyof SelectionTransformSnapshot, true> 让"加了字段却忘记补"
 * 在编译期就过不去:少一个键报缺失,多一个键报多余。
 *
 * 此前这里的注释把选择写成"运行时反射 vs 手写字段链会变味"这两个,然后选了
 * Object.keys —— 每次调用分配一个 13 元素数组,而这条比较在拖拽期间每帧都跑。
 * 那不是真的两难:键集是一个封闭接口,类型系统本来就能强制它。防线没有变弱,
 * 只是从运行时挪到了编译期;Object.keys 现在只在模块加载时跑一次。
 *
 * (react-redux 的 shallowEqual 用 Object.keys,是因为它是一个不知道键集的通用
 * 工具。这里知道,所以那个类比不成立。)
 */
const SNAPSHOT_SHAPE = {
  isReadonly: true,
  hasLockedShape: true,
  hasMixedRotation: true,
  canMove: true,
  canResize: true,
  canRotate: true,
  hasForcedAspectRatio: true,
  count: true,
  x: true,
  y: true,
  width: true,
  height: true,
  rotation: true,
} satisfies Record<keyof SelectionTransformSnapshot, true>

const SNAPSHOT_FIELDS = Object.keys(SNAPSHOT_SHAPE) as (keyof SelectionTransformSnapshot)[]

/*
 * 快照是一个值:十三个数字、布尔与 null,全部 readonly。而 deriveSelectionGeometry
 * 每次重算都交出一个新对象,于是任何按引用比较的消费者(信号就是这么比的)会在每
 * 一次编辑器 tick 上都观察到"变了"。这个函数是类型一直暗示着的那一半:值相等。
 *
 * 用 Object.is 而不是 ===,这样一个 NaN 的 rotation 不会与自己不等、每帧强制重画。
 */
export function selectionTransformSnapshotsEqual(
  left: SelectionTransformSnapshot,
  right: SelectionTransformSnapshot,
): boolean {
  for (const key of SNAPSHOT_FIELDS) {
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
 * This previously took five separate walks, three of which resolved the same
 * shape's ShapeUtil independently, so every shape was looked up three times on
 * every frame of a drag. A sixth walk built a rotations array that was read
 * once for its first element and then discarded, allocating an N-element array
 * per frame for nothing.
 *
 * The comment this replaces claimed the loop "breaks as soon as" the three
 * capability predicates settle. It never did, and still does not — settling
 * only lets the body skip one ShapeUtil lookup. Nothing here can stop early,
 * because rotation and lock state have to be read for every shape regardless.
 *
 * The pass below is still single, and each shape still resolves its ShapeUtil
 * at most once. What the two observe helpers buy is that the condition allowing
 * a lookup to be skipped now sits beside the three predicates that depend on
 * it, instead of being something the reader has to re-derive.
 */
/*
 * 遍历期间累加的可变状态。
 *
 * 之所以是一个可变对象而不是每个 shape 返回一个新的部分结果：拖拽期间这条路
 * 径每帧都会跑，按 shape 分配对象会把上面注释里刚省下来的开销原样还回去。
 * 遍历次数、每个 shape 的 getShapeUtil 查询次数、整体分配次数都与拆分前一致，
 * 拆开的只是"观察什么"这件事本身。
 */
interface SelectionSurveyAccumulator {
  firstRotation: number | null
  hasMixedRotation: boolean
  hasLockedShape: boolean
  allResizable: boolean
  allRotatable: boolean
  hasForcedAspectRatio: boolean
}

/*
 * canBeLaidOut 要的那个 info。
 *
 * 它在整次遍历里是同一个值:type 是常量,shapes 是同一个数组引用。此前它在
 * observeShapeUtilCapability 里逐个 shape 新建 —— 选中 200 个对象拖一秒就是
 * 一万两千次分配,换回来的是同一个东西。
 *
 * 同一个文件里 SelectionSurveyAccumulator 的注释已经把这条原则写清楚了
 * ("按 shape 分配会把省下的开销原样还回去"),只是没落到这里。
 */
const layoutOf = (shapes: TLShape[]) => ({ type: 'resize_to_bounds' as const, shapes })

type SelectionLayout = ReturnType<typeof layoutOf>

function surveySelection(editor: Editor, shapes: TLShape[]): SelectionSurvey {
  const survey: SelectionSurveyAccumulator = {
    firstRotation: null,
    hasMixedRotation: false,
    hasLockedShape: false,
    allResizable: true,
    allRotatable: true,
    hasForcedAspectRatio: false,
  }

  const layout = layoutOf(shapes)

  for (const shape of shapes) {
    if (shape.isLocked) {
      survey.hasLockedShape = true
    }

    observeRotation(survey, editor, shape)
    observeShapeUtilCapability(survey, editor, shape, layout)
  }

  return {
    firstRotation: survey.firstRotation ?? 0,
    hasMixedRotation: survey.hasMixedRotation,
    hasLockedShape: survey.hasLockedShape,
    allResizable: survey.allResizable,
    allRotatable: survey.allRotatable,
    hasForcedAspectRatio: survey.hasForcedAspectRatio,
  }
}

/*
 * 第一个 shape 定义基准角度，后续 shape 只需要回答"是否偏离基准"，一旦确认
 * 偏离就不再比较。
 */
function observeRotation(survey: SelectionSurveyAccumulator, editor: Editor, shape: TLShape): void {
  const rotation = editor.getShapePageTransform(shape)?.rotation() ?? 0

  if (survey.firstRotation === null) {
    survey.firstRotation = rotation
    return
  }

  if (survey.hasMixedRotation) {
    return
  }

  if (Math.abs(normalizeRadians(rotation - survey.firstRotation)) > EPSILON) {
    survey.hasMixedRotation = true
  }
}

/*
 * 三个能力判定都要问 ShapeUtil，所以共用一次查询。三个结论全部落定之后整个
 * 分支就没有任何可改变的东西了，直接跳过查询。
 */
function observeShapeUtilCapability(
  survey: SelectionSurveyAccumulator,
  editor: Editor,
  shape: TLShape,
  layout: SelectionLayout,
): void {
  if (!survey.allResizable && !survey.allRotatable && survey.hasForcedAspectRatio) {
    return
  }

  const util = editor.getShapeUtil(shape)

  if (survey.allResizable && !(util.canResize(shape) && util.canBeLaidOut(shape, layout))) {
    survey.allResizable = false
  }

  if (survey.allRotatable && util.hideRotateHandle(shape)) {
    survey.allRotatable = false
  }

  if (!survey.hasForcedAspectRatio && util.isAspectRatioLocked(shape)) {
    survey.hasForcedAspectRatio = true
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

/*
 * 三个提交动作的公共管线。
 *
 * 打一个历史停点,在一次 run 里变更,再把被遮挡的 shape 踢出来 —— 这三步此前在
 * 三个函数里各写一遍,连 shapes.map(id) 都各算一遍(rotation 那一支算了两遍)。
 * "提交一次选择变换"因此没有单一形状,加第四个字段就得再抄一遍。
 */
function runSelectionTransform(
  editor: Editor,
  label: string,
  shapes: readonly TLShape[],
  mutate: (ids: TLShapeId[]) => void,
): true {
  const ids = shapes.map((shape) => shape.id)

  editor.markHistoryStoppingPoint(label)

  editor.run(() => {
    mutate(ids)
    kickoutOccludedShapes(editor, ids)
  })

  return true
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

  return runSelectionTransform(
    editor,
    'edit selection position from status bar',
    geometry.shapes,
    () => {
      editor.updateShapes(updates)
    },
  )
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

  return runSelectionTransform(
    editor,
    'edit selection size from status bar',
    geometry.shapes,
    () => {
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
    },
  )
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

  return runSelectionTransform(
    editor,
    'edit selection rotation from status bar',
    geometry.shapes,
    (ids) => {
      editor.rotateShapesBy(ids, delta)
    },
  )
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
