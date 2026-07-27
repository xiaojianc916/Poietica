import { Box, Component, Move } from '@mynaui/icons-react'
import { Separator } from '@poietica/foundations-design-system'
import { useValue } from 'tldraw'

import { useEditor, useExtensionRegistration } from '../../react/editor-context'

export function CanvasInspector() {
  const editor = useEditor()
  const registration = useExtensionRegistration()
  const selectedShapes = useValue('selected shapes', () => editor?.getSelectedShapes() ?? [], [
    editor,
  ])
  const selectionBounds = useValue(
    'selection bounds',
    () => editor?.getSelectionPageBounds() ?? null,
    [editor],
  )
  const count = selectedShapes.length

  if (count === 0) {
    return (
      <InspectorEmptyState description="选择画布中的对象以查看和修改属性。" title="未选择对象" />
    )
  }

  if (count > 1) {
    return (
      <section className="py-4 text-center">
        <p className="text-[12px] font-medium">已选择 {count} 个对象</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          多选状态只显示所有对象共有的可编辑属性。
        </p>
      </section>
    )
  }

  const firstShape = selectedShapes[0]
  const shapeLabel = getShapeDisplayLabel(firstShape?.type, registration?.shapeLabels)

  return (
    <div className="space-y-0">
      <InspectorSection icon={<Move className="size-3.5" />} title="位置与尺寸">
        {selectionBounds ? (
          <div className="grid grid-cols-2 gap-2">
            <ReadOnlyValue label="X" value={Math.round(selectionBounds.x)} />
            <ReadOnlyValue label="Y" value={Math.round(selectionBounds.y)} />
            <ReadOnlyValue label="W" value={Math.round(selectionBounds.width)} />
            <ReadOnlyValue label="H" value={Math.round(selectionBounds.height)} />
          </div>
        ) : null}
        <PropertyRow label="约束" value="左侧 · 顶部" />
      </InspectorSection>
      <Separator />
      <InspectorSection icon={<Component className="size-3.5" />} title="外观">
        <PropertyRow label="对象类型" value={shapeLabel ?? '对象'} />
        <PropertyRow label="旋转" value="0°" />
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
          外观编辑将在形状属性 Command 接入后启用；当前只展示编辑器的真实选择数据。
        </div>
      </InspectorSection>
      <Separator />
      <InspectorSection icon={<Box className="size-3.5" />} title="排列">
        <PropertyRow label="层级" value="当前图层" />
        <PropertyRow label="锁定" value="否" />
      </InspectorSection>
      <Separator />
      <InspectorSection icon={<Component className="size-3.5" />} title="语义">
        <PropertyRow label="类型" monospace value={firstShape?.type ?? 'unknown'} />
        <PropertyRow label="选择数量" value="1" />
      </InspectorSection>
    </div>
  )
}

interface InspectorSectionProps {
  readonly title: string
  readonly icon: React.ReactNode
  readonly children: React.ReactNode
}

function InspectorSection({ title, icon, children }: InspectorSectionProps) {
  return (
    <section className="py-4 first:pt-1">
      <header className="mb-3 flex items-center gap-2 text-[11px] font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        <h2>{title}</h2>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

interface PropertyRowProps {
  readonly label: string
  readonly value: string
  readonly monospace?: boolean
}

function PropertyRow({ label, value, monospace = false }: PropertyRowProps) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={monospace ? 'truncate font-mono text-[10px]' : 'truncate font-medium'}>
        {value}
      </span>
    </div>
  )
}

interface ReadOnlyValueProps {
  readonly label: string
  readonly value: number
}

function ReadOnlyValue({ label, value }: ReadOnlyValueProps) {
  return (
    <div>
      <span className="mb-1 block text-[10px] text-muted-foreground">{label}</span>
      <div className="flex h-8 items-center justify-between rounded-md border bg-background px-2">
        <span className="text-[11px]">{value}</span>
        <span className="text-[9px] text-muted-foreground">px</span>
      </div>
    </div>
  )
}

function InspectorEmptyState({
  title,
  description,
}: {
  readonly title: string
  readonly description: string
}) {
  return (
    <section className="px-3 py-10 text-center">
      <p className="text-[12px] font-medium">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
    </section>
  )
}

function getShapeDisplayLabel(
  shapeType: string | undefined,
  extensionLabels: Readonly<Record<string, string>> | undefined,
): string | null {
  if (!shapeType) {
    return null
  }
  return SHAPE_TYPE_LABELS[shapeType] ?? extensionLabels?.[shapeType] ?? null
}

const SHAPE_TYPE_LABELS: Record<string, string> = {
  geo: '形状',
  arrow: '连接线',
  text: '文本',
  draw: '笔迹',
  note: '便签',
  image: '图片',
}
