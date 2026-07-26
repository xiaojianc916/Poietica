import { type ReactNode, useMemo, useRef } from 'react'
import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  ArrowShapeKindStyle,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultSizeStyle,
  DefaultTextAlignStyle,
  DefaultVerticalAlignStyle,
  defaultGeoTypeDefinitions,
  GeoShapeGeoStyle,
  getColorStyleItems,
  getColorValue,
  LineShapeSplineStyle,
  type ReadonlySharedStyleMap,
  type SharedStyle,
  type StyleProp,
  type TLDefaultColorStyle,
  type TLGeoShape,
  type TLUiActionItem,
  type TLUiIconType,
  TldrawUiIcon,
  TldrawUiTooltip,
  useActions,
  useEditor,
  useStylePanelContext,
  useValue,
} from 'tldraw'

interface SelectionCapabilities {
  readonly canAlign: boolean
  readonly canDistribute: boolean
  readonly canStretch: boolean
  readonly canStack: boolean
  readonly canPack: boolean
  readonly canArrange: boolean
  readonly canEnableTextAutoSize: boolean
  readonly canEditLink: boolean
  readonly canManageFrame: boolean
  readonly canReplaceImage: boolean
  readonly canReplaceVideo: boolean
  readonly canDownloadImage: boolean
  readonly canDownloadVideo: boolean
  readonly canCropImage: boolean
  readonly canToggleLock: boolean
  readonly canReorder: boolean
  readonly canGroup: boolean
  readonly canUngroup: boolean
  readonly canRotate: boolean
  readonly canFrame: boolean
  readonly canDuplicate: boolean
  readonly canDelete: boolean
  readonly canFlip: boolean
  readonly canOpenEmbedLink: boolean
  readonly canConvertEmbedToBookmark: boolean
  readonly canConvertBookmarkToEmbed: boolean
}

type SelectionLockState = 'locked' | 'unlocked' | 'mixed'

interface SelectionInspectorSnapshot {
  readonly title: string
  readonly isCroppingImage: boolean
  readonly selectionLockState: SelectionLockState
  readonly selectionCapabilities: SelectionCapabilities
}

const selectionCapabilityKeys = [
  'canAlign',
  'canDistribute',
  'canStretch',
  'canStack',
  'canPack',
  'canArrange',
  'canEnableTextAutoSize',
  'canEditLink',
  'canManageFrame',
  'canReplaceImage',
  'canReplaceVideo',
  'canDownloadImage',
  'canDownloadVideo',
  'canCropImage',
  'canToggleLock',
  'canReorder',
  'canGroup',
  'canUngroup',
  'canRotate',
  'canFrame',
  'canDuplicate',
  'canDelete',
  'canFlip',
  'canOpenEmbedLink',
  'canConvertEmbedToBookmark',
  'canConvertBookmarkToEmbed',
] as const satisfies readonly (keyof SelectionCapabilities)[]

function selectionInspectorSnapshotsEqual(
  left: SelectionInspectorSnapshot,
  right: SelectionInspectorSnapshot,
): boolean {
  if (
    left.title !== right.title ||
    left.isCroppingImage !== right.isCroppingImage ||
    left.selectionLockState !== right.selectionLockState
  ) {
    return false
  }

  return selectionCapabilityKeys.every(
    (key) => left.selectionCapabilities[key] === right.selectionCapabilities[key],
  )
}

export interface PropertiesInspectorContentProps {
  readonly styles: ReadonlySharedStyleMap | null
  readonly selectedShapeCount: number
}

interface StyleOption<TValue extends string> {
  readonly value: TValue
  readonly icon: TLUiIconType
  readonly label: string
}

const fillOptions = [
  {
    value: 'none',
    icon: 'fill-none',
    label: '无填充',
  },
  {
    value: 'semi',
    icon: 'fill-semi',
    label: '半透明',
  },
  {
    value: 'solid',
    icon: 'fill-solid',
    label: '实色',
  },
  {
    value: 'pattern',
    icon: 'fill-pattern',
    label: '图案',
  },
] as const

const dashOptions = [
  {
    value: 'draw',
    icon: 'dash-draw',
    label: '手绘',
  },
  {
    value: 'solid',
    icon: 'dash-solid',
    label: '实线',
  },
  {
    value: 'dashed',
    icon: 'dash-dashed',
    label: '虚线',
  },
  {
    value: 'dotted',
    icon: 'dash-dotted',
    label: '点线',
  },
] as const

const sizeOptions = [
  {
    value: 's',
    icon: 'size-small',
    label: '小',
  },
  {
    value: 'm',
    icon: 'size-medium',
    label: '中',
  },
  {
    value: 'l',
    icon: 'size-large',
    label: '大',
  },
  {
    value: 'xl',
    icon: 'size-extra-large',
    label: '特大',
  },
] as const

const fontOptions = [
  {
    value: 'draw',
    icon: 'font-draw',
    label: '手写',
  },
  {
    value: 'sans',
    icon: 'font-sans',
    label: '无衬线',
  },
  {
    value: 'serif',
    icon: 'font-serif',
    label: '衬线',
  },
  {
    value: 'mono',
    icon: 'font-mono',
    label: '等宽',
  },
] as const

const textAlignOptions = [
  {
    value: 'start',
    icon: 'text-align-left',
    label: '左对齐',
  },
  {
    value: 'middle',
    icon: 'text-align-center',
    label: '居中',
  },
  {
    value: 'end',
    icon: 'text-align-right',
    label: '右对齐',
  },
] as const

const horizontalAlignOptions = [
  {
    value: 'start',
    icon: 'horizontal-align-start',
    label: '左侧',
  },
  {
    value: 'middle',
    icon: 'horizontal-align-middle',
    label: '水平居中',
  },
  {
    value: 'end',
    icon: 'horizontal-align-end',
    label: '右侧',
  },
] as const

const verticalAlignOptions = [
  {
    value: 'start',
    icon: 'vertical-align-start',
    label: '顶部',
  },
  {
    value: 'middle',
    icon: 'vertical-align-middle',
    label: '垂直居中',
  },
  {
    value: 'end',
    icon: 'vertical-align-end',
    label: '底部',
  },
] as const

const arrowKindOptions = [
  {
    value: 'arc',
    icon: 'arrow-arc',
    label: '曲线箭头',
  },
  {
    value: 'elbow',
    icon: 'arrow-elbow',
    label: '折线箭头',
  },
] as const

const arrowheadOptions = [
  {
    value: 'none',
    icon: 'arrowhead-none',
    label: '无端点',
  },
  {
    value: 'arrow',
    icon: 'arrowhead-arrow',
    label: '箭头',
  },
  {
    value: 'triangle',
    icon: 'arrowhead-triangle',
    label: '三角形',
  },
  {
    value: 'square',
    icon: 'arrowhead-square',
    label: '方形',
  },
  {
    value: 'dot',
    icon: 'arrowhead-dot',
    label: '圆点',
  },
  {
    value: 'diamond',
    icon: 'arrowhead-diamond',
    label: '菱形',
  },
  {
    value: 'inverted',
    icon: 'arrowhead-triangle-inverted',
    label: '反向三角',
  },
  {
    value: 'bar',
    icon: 'arrowhead-bar',
    label: '端线',
  },
] as const

const splineOptions = [
  {
    value: 'line',
    icon: 'spline-line',
    label: '直线',
  },
  {
    value: 'cubic',
    icon: 'spline-cubic',
    label: '曲线',
  },
] as const

const opacityOptions = [
  {
    value: 0.1,
    label: '10%',
  },
  {
    value: 0.25,
    label: '25%',
  },
  {
    value: 0.5,
    label: '50%',
  },
  {
    value: 0.75,
    label: '75%',
  },
  {
    value: 1,
    label: '100%',
  },
] as const

const geoLabels: Partial<Record<TLGeoShape['props']['geo'], string>> = {
  rectangle: '矩形',
  ellipse: '椭圆',
  triangle: '三角形',
  diamond: '菱形',
  star: '星形',
  pentagon: '五边形',
  hexagon: '六边形',
  octagon: '八边形',
  rhombus: '平行四边形',
  'rhombus-2': '反向平行四边形',
  oval: '椭圆框',
  trapezoid: '梯形',
  'arrow-left': '左箭头',
  'arrow-up': '上箭头',
  'arrow-down': '下箭头',
  'arrow-right': '右箭头',
  cloud: '云形',
  'x-box': '叉号框',
  'check-box': '勾选框',
  heart: '心形',
}

const geoOptions: readonly StyleOption<TLGeoShape['props']['geo']>[] = Object.entries(
  defaultGeoTypeDefinitions,
).map(([value, definition]) => ({
  value: value as TLGeoShape['props']['geo'],
  icon: definition.icon as TLUiIconType,
  label: geoLabels[value as TLGeoShape['props']['geo']] ?? value,
}))

export function PropertiesInspectorContent({
  styles,
  selectedShapeCount,
}: PropertiesInspectorContentProps) {
  const editor = useEditor()

  const previousSnapshotRef = useRef<SelectionInspectorSnapshot | null>(null)

  const { title, isCroppingImage, selectionLockState, selectionCapabilities } =
    useValue<SelectionInspectorSnapshot>(
      'right properties sidebar selection view model',
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: all selection facts are derived from one consistent editor snapshot and one shape-util pass
      () => {
        const selected = editor.getSelectedShapes()
        const selectedCount = selected.length
        const hasSelection = selectedCount > 0
        const readonly = editor.getIsReadonly()

        let lockedCount = 0

        for (const shape of selected) {
          if (shape.isLocked) {
            lockedCount += 1
          }
        }

        const allUnlocked = hasSelection && lockedCount === 0

        const selectionLockState: SelectionLockState =
          lockedCount === 0 ? 'unlocked' : lockedCount === selectedCount ? 'locked' : 'mixed'

        let canAlign = !readonly && allUnlocked && selectedCount >= 2
        let canDistribute = !readonly && allUnlocked && selectedCount >= 3
        let canStretch = !readonly && allUnlocked && selectedCount >= 2
        let canStack = !readonly && allUnlocked && selectedCount >= 2
        let canPack = !readonly && allUnlocked && selectedCount >= 2
        let canFlip = !readonly && allUnlocked
        let allRotatable = allUnlocked
        let canEnableTextAutoSize = false

        /*
         * Evaluate all layout capabilities in one selection pass.
         *
         * The previous implementation traversed the complete selection once for
         * every operation type and repeatedly resolved the same ShapeUtil.
         */
        for (const shape of selected) {
          const shapeUtil = editor.getShapeUtil(shape)

          if (
            canAlign &&
            !shapeUtil.canBeLaidOut(shape, {
              type: 'align',
              shapes: selected,
            })
          ) {
            canAlign = false
          }

          if (
            canDistribute &&
            !shapeUtil.canBeLaidOut(shape, {
              type: 'distribute',
              shapes: selected,
            })
          ) {
            canDistribute = false
          }

          if (
            canStretch &&
            !shapeUtil.canBeLaidOut(shape, {
              type: 'stretch',
              shapes: selected,
            })
          ) {
            canStretch = false
          }

          if (
            canStack &&
            !shapeUtil.canBeLaidOut(shape, {
              type: 'stack',
              shapes: selected,
            })
          ) {
            canStack = false
          }

          if (
            canPack &&
            !shapeUtil.canBeLaidOut(shape, {
              type: 'pack',
              shapes: selected,
            })
          ) {
            canPack = false
          }

          if (
            canFlip &&
            !shapeUtil.canBeLaidOut(shape, {
              type: 'flip',
              shapes: selected,
            })
          ) {
            canFlip = false
          }

          if (allRotatable && shapeUtil.hideRotateHandle(shape)) {
            allRotatable = false
          }

          if (
            !canEnableTextAutoSize &&
            editor.isShapeOfType(shape, 'text') &&
            shape.props.autoSize === false
          ) {
            canEnableTextAutoSize = true
          }
        }

        canEnableTextAutoSize = !readonly && allUnlocked && canEnableTextAutoSize

        const onlySelected = selectedCount === 1 ? (selected[0] ?? null) : null
        const onlySelectedIsUnlocked = onlySelected !== null && !onlySelected.isLocked
        const onlySelectedIsFrameLike =
          onlySelected !== null && editor.isShapeFrameLike(onlySelected)
        const onlySelectedIsImage =
          onlySelected !== null && editor.isShapeOfType(onlySelected, 'image')
        const onlySelectedIsVideo =
          onlySelected !== null && editor.isShapeOfType(onlySelected, 'video')
        const onlySelectedIsEmbed =
          onlySelected !== null && editor.isShapeOfType(onlySelected, 'embed')
        const onlySelectedIsBookmark =
          onlySelected !== null && editor.isShapeOfType(onlySelected, 'bookmark')

        const onlySelectedHasUrl =
          onlySelected !== null &&
          'url' in onlySelected.props &&
          typeof onlySelected.props.url === 'string' &&
          onlySelected.props.url.length > 0

        const onlySelectedHasMediaAsset =
          onlySelected !== null &&
          'assetId' in onlySelected.props &&
          onlySelected.props.assetId !== null &&
          onlySelected.props.assetId !== undefined

        const canCropImage =
          !readonly &&
          onlySelectedIsUnlocked &&
          onlySelectedIsImage &&
          editor.canCropShape(onlySelected)

        const selectionCapabilities: SelectionCapabilities = {
          canAlign,
          canDistribute,
          canStretch,
          canStack,
          canPack,
          canFlip,
          canArrange: canAlign || canDistribute || canStretch || canStack || canPack || canFlip,
          canEnableTextAutoSize,
          canEditLink: !readonly && onlySelectedIsUnlocked && onlySelectedHasUrl,
          canOpenEmbedLink: onlySelectedIsEmbed && onlySelectedHasUrl,
          canConvertEmbedToBookmark:
            !readonly && onlySelectedIsUnlocked && onlySelectedIsEmbed && onlySelectedHasUrl,
          canConvertBookmarkToEmbed:
            !readonly && onlySelectedIsUnlocked && onlySelectedIsBookmark && onlySelectedHasUrl,
          canManageFrame: !readonly && onlySelectedIsUnlocked && onlySelectedIsFrameLike,
          canReplaceImage: !readonly && onlySelectedIsUnlocked && onlySelectedIsImage,
          canReplaceVideo: !readonly && onlySelectedIsUnlocked && onlySelectedIsVideo,
          canDownloadImage: onlySelectedIsImage && onlySelectedHasMediaAsset,
          canDownloadVideo: onlySelectedIsVideo && onlySelectedHasMediaAsset,
          canCropImage,
          canToggleLock: !readonly && hasSelection,
          canReorder: !readonly && allUnlocked,
          canGroup: !readonly && allUnlocked && selectedCount >= 2,
          canUngroup: !readonly && onlySelectedIsUnlocked && onlySelected?.type === 'group',
          canRotate: !readonly && hasSelection && allRotatable,
          canFrame: !readonly && allUnlocked && selectedCount >= 2,
          canDuplicate: !readonly && hasSelection,
          canDelete: !readonly && allUnlocked,
        }

        const title =
          selectedCount > 1
            ? `${String(selectedCount)} 个对象`
            : selectedCount === 1
              ? getShapeTitle(onlySelected?.type)
              : getToolTitle(editor.getCurrentToolId())

        const nextSnapshot: SelectionInspectorSnapshot = {
          title,
          isCroppingImage: editor.isIn('select.crop.'),
          selectionLockState,
          selectionCapabilities,
        }

        const previousSnapshot = previousSnapshotRef.current

        /*
         * tldraw may recompute this value while selected records move. Reuse the
         * previous object when all UI-visible values are unchanged so React does
         * not rerender the complete inspector for position-only transactions.
         */
        if (previousSnapshot && selectionInspectorSnapshotsEqual(previousSnapshot, nextSnapshot)) {
          return previousSnapshot
        }

        previousSnapshotRef.current = nextSnapshot

        return nextSnapshot
      },
      [editor],
    )

  return (
    <div className="hc-properties-sidebar__panel">
      <header className="hc-properties-sidebar__header">
        <span className="hc-properties-sidebar__title">{title}</span>
      </header>

      {styles ? <StyleSections styles={styles} /> : null}

      {selectedShapeCount > 0 ? (
        <SelectionActions
          capabilities={selectionCapabilities}
          isCroppingImage={isCroppingImage}
          selectionLockState={selectionLockState}
        />
      ) : null}
    </div>
  )
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 样式面板按可用共享样式声明式渲染，各条件对应独立控件
function StyleSections({ styles }: { readonly styles: ReadonlySharedStyleMap }) {
  const editor = useEditor()

  const opacity = useValue('right properties sidebar opacity', () => editor.getSharedOpacity(), [
    editor,
  ])

  const color = styles.get(DefaultColorStyle)

  const fill = styles.get(DefaultFillStyle)

  const dash = styles.get(DefaultDashStyle)

  const size = styles.get(DefaultSizeStyle)

  const font = styles.get(DefaultFontStyle)

  const textAlign = styles.get(DefaultTextAlignStyle)

  const horizontalAlign = styles.get(DefaultHorizontalAlignStyle)

  const verticalAlign = styles.get(DefaultVerticalAlignStyle)

  const geo = styles.get(GeoShapeGeoStyle)

  const arrowKind = styles.get(ArrowShapeKindStyle)

  const arrowheadStart = styles.get(ArrowShapeArrowheadStartStyle)

  const arrowheadEnd = styles.get(ArrowShapeArrowheadEndStyle)

  const spline = styles.get(LineShapeSplineStyle)

  const hasAppearance = color !== undefined || opacity !== undefined

  const hasCommonStyle = fill !== undefined || dash !== undefined || size !== undefined

  const hasText =
    font !== undefined ||
    textAlign !== undefined ||
    horizontalAlign !== undefined ||
    verticalAlign !== undefined

  const hasArrow =
    arrowKind !== undefined ||
    arrowheadStart !== undefined ||
    arrowheadEnd !== undefined ||
    spline !== undefined

  return (
    <>
      {hasAppearance ? (
        <SidebarSection title="外观">
          {color ? (
            <SidebarField mixed={color.type === 'mixed'} title="颜色">
              <ColorControl value={color} />
            </SidebarField>
          ) : null}

          {opacity ? (
            <SidebarField mixed={opacity.type === 'mixed'} title="透明度">
              <OpacityControl value={opacity} />
            </SidebarField>
          ) : null}
        </SidebarSection>
      ) : null}

      {hasCommonStyle ? (
        <SidebarSection title="样式">
          {fill ? (
            <SidebarField mixed={fill.type === 'mixed'} title="填充">
              <StyleControl options={fillOptions} style={DefaultFillStyle} value={fill} />
            </SidebarField>
          ) : null}

          {dash ? (
            <SidebarField mixed={dash.type === 'mixed'} title="线条">
              <StyleControl options={dashOptions} style={DefaultDashStyle} value={dash} />
            </SidebarField>
          ) : null}

          {size ? (
            <SidebarField mixed={size.type === 'mixed'} title="粗细">
              <StyleControl options={sizeOptions} style={DefaultSizeStyle} value={size} />
            </SidebarField>
          ) : null}
        </SidebarSection>
      ) : null}

      {hasText ? (
        <SidebarSection title="文本">
          {font ? (
            <SidebarField mixed={font.type === 'mixed'} title="字体">
              <StyleControl options={fontOptions} style={DefaultFontStyle} value={font} />
            </SidebarField>
          ) : null}

          {textAlign ? (
            <SidebarField mixed={textAlign.type === 'mixed'} title="文本对齐">
              <StyleControl
                options={textAlignOptions}
                style={DefaultTextAlignStyle}
                value={textAlign}
              />
            </SidebarField>
          ) : null}

          {horizontalAlign ? (
            <SidebarField mixed={horizontalAlign.type === 'mixed'} title="水平位置">
              <StyleControl
                options={horizontalAlignOptions}
                style={DefaultHorizontalAlignStyle}
                value={horizontalAlign}
              />
            </SidebarField>
          ) : null}

          {verticalAlign ? (
            <SidebarField mixed={verticalAlign.type === 'mixed'} title="垂直位置">
              <StyleControl
                options={verticalAlignOptions}
                style={DefaultVerticalAlignStyle}
                value={verticalAlign}
              />
            </SidebarField>
          ) : null}
        </SidebarSection>
      ) : null}

      {geo ? (
        <SidebarSection title="形状类型">
          <SidebarField mixed={geo.type === 'mixed'} title="图形">
            <StyleControl options={geoOptions} style={GeoShapeGeoStyle} value={geo} />
          </SidebarField>
        </SidebarSection>
      ) : null}

      {hasArrow ? (
        <SidebarSection title="线条与箭头">
          {arrowKind ? (
            <SidebarField mixed={arrowKind.type === 'mixed'} title="类型">
              <StyleControl
                options={arrowKindOptions}
                style={ArrowShapeKindStyle}
                value={arrowKind}
              />
            </SidebarField>
          ) : null}

          {spline ? (
            <SidebarField mixed={spline.type === 'mixed'} title="路径">
              <StyleControl options={splineOptions} style={LineShapeSplineStyle} value={spline} />
            </SidebarField>
          ) : null}

          {arrowheadStart ? (
            <SidebarField mixed={arrowheadStart.type === 'mixed'} title="起点">
              <StyleControl
                options={arrowheadOptions}
                style={ArrowShapeArrowheadStartStyle}
                value={arrowheadStart}
              />
            </SidebarField>
          ) : null}

          {arrowheadEnd ? (
            <SidebarField mixed={arrowheadEnd.type === 'mixed'} title="终点">
              <StyleControl
                options={arrowheadOptions}
                style={ArrowShapeArrowheadEndStyle}
                value={arrowheadEnd}
              />
            </SidebarField>
          ) : null}
        </SidebarSection>
      ) : null}
    </>
  )
}

function OpacityControl({ value }: { readonly value: SharedStyle<number> }) {
  const styleContext = useStylePanelContext()

  return (
    <fieldset
      aria-label="透明度"
      className="hc-properties-sidebar__opacity"
      data-mixed={value.type === 'mixed' ? '' : undefined}
      style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
    >
      {opacityOptions.map((option) => {
        const active = value.type === 'shared' && value.value === option.value

        return (
          <TldrawUiTooltip
            content={`透明度 ${option.label}`}
            key={option.value}
            side="left"
            sideOffset={8}
          >
            <button
              aria-label={`透明度 ${option.label}`}
              aria-pressed={active}
              className="hc-properties-sidebar__opacity-option"
              onClick={() => {
                styleContext.onHistoryMark('change opacity')

                styleContext.onOpacityChange(option.value)
              }}
              type="button"
            >
              {option.label}
            </button>
          </TldrawUiTooltip>
        )
      })}
    </fieldset>
  )
}

function ColorControl({ value }: { readonly value: SharedStyle<TLDefaultColorStyle> }) {
  const editor = useEditor()
  const styleContext = useStylePanelContext()

  const colors = useValue(
    'right properties sidebar colors',
    () => editor.getCurrentTheme().colors[editor.getColorMode()],
    [editor],
  )

  const items = useMemo(() => getColorStyleItems(colors), [colors])

  return (
    <fieldset
      aria-label="颜色"
      className="hc-properties-sidebar__color-grid"
      data-mixed={value.type === 'mixed' ? '' : undefined}
      style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
    >
      {items.map((item) => {
        const colorValue = item.value as TLDefaultColorStyle

        const active = value.type === 'shared' && value.value === colorValue

        const label = `颜色 — ${getColorLabel(colorValue)}`

        return (
          <TldrawUiTooltip content={label} key={item.value} side="left" sideOffset={8}>
            <button
              aria-label={label}
              aria-pressed={active}
              className="hc-properties-sidebar__color-button"
              onClick={() => {
                styleContext.onHistoryMark('change color')

                styleContext.onValueChange(DefaultColorStyle, colorValue)
              }}
              style={
                {
                  '--hc-swatch-color': getColorValue(colors, colorValue, 'solid'),
                } as React.CSSProperties
              }
              type="button"
            >
              <TldrawUiIcon icon="color" label={label} />
            </button>
          </TldrawUiTooltip>
        )
      })}
    </fieldset>
  )
}

interface StyleControlProps<TValue extends string> {
  readonly style: StyleProp<TValue>
  readonly value: SharedStyle<TValue>
  readonly options: readonly StyleOption<TValue>[]
}

function StyleControl<TValue extends string>({ style, value, options }: StyleControlProps<TValue>) {
  const styleContext = useStylePanelContext()

  return (
    <fieldset
      className={
        options.length > 4
          ? 'hc-properties-sidebar__segmented hc-properties-sidebar__segmented--grid'
          : 'hc-properties-sidebar__segmented'
      }
      data-mixed={value.type === 'mixed' ? '' : undefined}
      style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
    >
      {options.map((option) => {
        const active = value.type === 'shared' && value.value === option.value

        return (
          <TldrawUiTooltip content={option.label} key={option.value} side="left" sideOffset={8}>
            <button
              aria-label={option.label}
              aria-pressed={active}
              className="hc-properties-sidebar__segment"
              onClick={() => {
                styleContext.onHistoryMark(`change ${style.id}`)

                styleContext.onValueChange(style, option.value)
              }}
              type="button"
            >
              <TldrawUiIcon icon={option.icon} label={option.label} />
            </button>
          </TldrawUiTooltip>
        )
      })}
    </fieldset>
  )
}

interface SidebarSectionProps {
  readonly title: string
  readonly children: ReactNode
}

function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <section className="hc-properties-sidebar__section">
      <h2 className="hc-properties-sidebar__section-title">{title}</h2>

      <div className="hc-properties-sidebar__section-content">{children}</div>
    </section>
  )
}

interface SidebarFieldProps {
  readonly title: string
  readonly mixed: boolean
  readonly children: ReactNode
}

function SidebarField({ title, mixed, children }: SidebarFieldProps) {
  return (
    <div className="hc-properties-sidebar__field">
      <div className="hc-properties-sidebar__field-header">
        <span>{title}</span>

        {mixed ? (
          <span className="hc-properties-sidebar__mixed" title="多个值">
            <TldrawUiIcon icon="mixed" label="多个值" small />
          </span>
        ) : null}
      </div>

      {children}
    </div>
  )
}

interface SelectionActionsProps {
  readonly capabilities: SelectionCapabilities
  readonly isCroppingImage: boolean
  readonly selectionLockState: 'locked' | 'unlocked' | 'mixed'
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 操作面板集中映射选择能力到独立按钮，条件不共享控制流
function SelectionActions({
  capabilities,
  isCroppingImage,
  selectionLockState,
}: SelectionActionsProps) {
  const actions = useActions()

  return (
    <>
      {capabilities.canArrange ? (
        <SidebarSection title="排列">
          <div className="hc-properties-sidebar__action-grid">
            {capabilities.canAlign ? (
              <>
                <ActionButton actions={actions} id="align-left" label="左对齐" />

                <ActionButton actions={actions} id="align-center-horizontal" label="水平居中" />

                <ActionButton actions={actions} id="align-right" label="右对齐" />

                <ActionButton actions={actions} id="align-top" label="顶部对齐" />

                <ActionButton actions={actions} id="align-center-vertical" label="垂直居中" />

                <ActionButton actions={actions} id="align-bottom" label="底部对齐" />
              </>
            ) : null}

            {capabilities.canDistribute ? (
              <>
                <ActionButton actions={actions} id="distribute-horizontal" label="水平分布" />

                <ActionButton actions={actions} id="distribute-vertical" label="垂直分布" />
              </>
            ) : null}

            {capabilities.canStretch ? (
              <>
                <ActionButton actions={actions} id="stretch-horizontal" label="水平拉伸" />

                <ActionButton actions={actions} id="stretch-vertical" label="垂直拉伸" />
              </>
            ) : null}

            {capabilities.canStack ? (
              <>
                <ActionButton actions={actions} id="stack-horizontal" label="水平堆叠" />

                <ActionButton actions={actions} id="stack-vertical" label="垂直堆叠" />
              </>
            ) : null}

            {capabilities.canPack ? (
              <ActionButton actions={actions} id="pack" label="紧凑排列" />
            ) : null}

            {capabilities.canFlip ? (
              <>
                <ActionButton
                  actions={actions}
                  icon="chevrons-ne"
                  id="flip-horizontal"
                  label="水平翻转"
                />

                <ActionButton
                  actions={actions}
                  icon="chevrons-sw"
                  id="flip-vertical"
                  label="垂直翻转"
                />
              </>
            ) : null}
          </div>
        </SidebarSection>
      ) : null}

      {capabilities.canReorder ? (
        <SidebarSection title="层级">
          <div className="hc-properties-sidebar__action-grid">
            <ActionButton actions={actions} id="bring-to-front" label="置于顶层" />

            <ActionButton actions={actions} id="bring-forward" label="上移一层" />

            <ActionButton actions={actions} id="send-backward" label="下移一层" />

            <ActionButton actions={actions} id="send-to-back" label="置于底层" />
          </div>
        </SidebarSection>
      ) : null}

      <SidebarSection title="对象">
        <div className="hc-properties-sidebar__action-grid">
          {capabilities.canEditLink ? (
            <ActionButton actions={actions} id="edit-link" label="编辑链接" />
          ) : null}

          {capabilities.canOpenEmbedLink ? (
            <ActionButton
              actions={actions}
              icon="external-link"
              id="open-embed-link"
              label="打开嵌入链接"
            />
          ) : null}

          {capabilities.canConvertEmbedToBookmark ? (
            <ActionButton
              actions={actions}
              icon="bookmark"
              id="convert-to-bookmark"
              label="转换为书签"
            />
          ) : null}

          {capabilities.canConvertBookmarkToEmbed ? (
            <ActionButton
              actions={actions}
              icon="external-link"
              id="convert-to-embed"
              label="转换为嵌入"
            />
          ) : null}

          {capabilities.canToggleLock ? (
            <ActionButton
              actions={actions}
              icon={selectionLockState === 'locked' ? 'unlock' : 'lock'}
              id="toggle-lock"
              label={
                selectionLockState === 'locked'
                  ? '解锁'
                  : selectionLockState === 'mixed'
                    ? '统一锁定'
                    : '锁定'
              }
            />
          ) : null}

          {capabilities.canUngroup ? (
            <ActionButton actions={actions} id="ungroup" label="取消编组" />
          ) : capabilities.canGroup ? (
            <ActionButton actions={actions} id="group" label="编组" />
          ) : null}

          {capabilities.canFrame ? (
            <ActionButton
              actions={actions}
              icon="tool-frame"
              id="frame-selection"
              label="创建画框"
            />
          ) : null}

          {capabilities.canManageFrame ? (
            <>
              <ActionButton
                actions={actions}
                icon="corners"
                id="fit-frame-to-content"
                label="适应内容"
              />

              <ActionButton actions={actions} icon="cross-2" id="remove-frame" label="移除画框" />
            </>
          ) : null}

          {capabilities.canCropImage ? <CropImageButton active={isCroppingImage} /> : null}

          {capabilities.canReplaceImage || capabilities.canDownloadImage ? (
            <>
              {capabilities.canReplaceImage ? (
                <ActionButton actions={actions} id="image-replace" label="替换图片" />
              ) : null}

              {capabilities.canDownloadImage ? (
                <ActionButton
                  actions={actions}
                  icon="download"
                  id="download-original"
                  label="下载原图"
                />
              ) : null}
            </>
          ) : null}

          {capabilities.canReplaceVideo || capabilities.canDownloadVideo ? (
            <>
              {capabilities.canReplaceVideo ? (
                <ActionButton actions={actions} id="video-replace" label="替换视频" />
              ) : null}

              {capabilities.canDownloadVideo ? (
                <ActionButton
                  actions={actions}
                  icon="download"
                  id="download-original"
                  label="下载原视频"
                />
              ) : null}
            </>
          ) : null}

          {capabilities.canEnableTextAutoSize ? (
            <ActionButton
              actions={actions}
              icon="toggle-on"
              id="toggle-auto-size"
              label="恢复自动宽度"
            />
          ) : null}

          {capabilities.canRotate ? (
            <>
              <ActionButton actions={actions} id="rotate-ccw" label="逆时针旋转" />

              <ActionButton actions={actions} id="rotate-cw" label="顺时针旋转" />
            </>
          ) : null}

          {capabilities.canDuplicate ? (
            <ActionButton actions={actions} id="duplicate" label="创建副本" />
          ) : null}

          {capabilities.canDelete ? (
            <ActionButton actions={actions} destructive id="delete" label="删除" />
          ) : null}
        </div>
      </SidebarSection>
    </>
  )
}

function CropImageButton({ active }: { readonly active: boolean }) {
  const editor = useEditor()

  const label = active ? '完成裁剪' : '裁剪图片'

  return (
    <TldrawUiTooltip content={label} side="left" sideOffset={8}>
      <button
        aria-label={label}
        aria-pressed={active}
        className="hc-properties-sidebar__action"
        onClick={() => {
          if (active) {
            editor.setCroppingShape(null)

            editor.setCurrentTool('select.idle')

            return
          }

          editor.setCurrentTool('select.crop.idle')
        }}
        type="button"
      >
        <TldrawUiIcon icon={active ? 'check' : 'crop'} label={label} />
      </button>
    </TldrawUiTooltip>
  )
}

function ActionButton({
  actions,
  id,
  label,
  icon,
  destructive = false,
}: {
  readonly actions: ReturnType<typeof useActions>
  readonly id: string
  readonly label: string
  readonly icon?: TLUiIconType
  readonly destructive?: boolean
}) {
  const item: TLUiActionItem | undefined = actions[id]

  if (!item) {
    return null
  }

  const resolvedIcon = icon ?? item.icon

  if (!resolvedIcon) {
    return null
  }

  return (
    <TldrawUiTooltip content={label} side="left" sideOffset={8}>
      <button
        aria-label={label}
        className={
          destructive
            ? 'hc-properties-sidebar__action hc-properties-sidebar__action--destructive'
            : 'hc-properties-sidebar__action'
        }
        onClick={() => {
          void item.onSelect('toolbar')
        }}
        type="button"
      >
        {typeof resolvedIcon === 'string' ? (
          <TldrawUiIcon icon={resolvedIcon as TLUiIconType} label={label} />
        ) : (
          resolvedIcon
        )}
      </button>
    </TldrawUiTooltip>
  )
}

function getToolTitle(toolId: string): string {
  const titles: Record<string, string> = {
    draw: '画笔',
    geo: '形状',
    arrow: '箭头',
    text: '文本',
    note: '便签',
    line: '线条',
    highlight: '高亮',
  }

  return titles[toolId] ?? '属性'
}

function getShapeTitle(shapeType: string | undefined): string {
  const titles: Record<string, string> = {
    geo: '形状',
    draw: '画笔',
    arrow: '箭头',
    text: '文本',
    note: '便签',
    line: '线条',
    highlight: '高亮',
    frame: '画框',
    image: '图片',
    video: '视频',
    embed: '嵌入',
    bookmark: '书签',
    group: '编组',
  }

  return shapeType ? (titles[shapeType] ?? '对象') : '对象'
}

function getColorLabel(color: TLDefaultColorStyle): string {
  const labels: Partial<Record<TLDefaultColorStyle, string>> = {
    black: '黑色',
    grey: '灰色',
    violet: '紫色',
    blue: '蓝色',
    'light-blue': '浅蓝色',
    yellow: '黄色',
    orange: '橙色',
    green: '绿色',
    'light-green': '浅绿色',
    red: '红色',
    'light-red': '浅红色',
  }

  return labels[color] ?? color
}
