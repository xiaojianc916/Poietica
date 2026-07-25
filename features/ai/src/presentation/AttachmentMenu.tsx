import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@hybrid-canvas/design-system'
import { Code, FileText, Paperclip, Plus } from '@mynaui/icons-react'

import type { AttachmentSourceId } from '../contracts/composer-contract'

const SOURCES: readonly {
  readonly id: AttachmentSourceId
  readonly label: string
  readonly icon: typeof Plus
}[] = [
  { id: 'files', label: '添加文件', icon: Paperclip },
  { id: 'code', label: '导入代码', icon: Code },
  { id: 'saved-prompt', label: '已保存提示词', icon: FileText },
]

export function AttachmentMenu({
  onSelect,
}: {
  readonly onSelect: (id: AttachmentSourceId) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="添加内容"
        className="grid size-8 place-items-center rounded-[10px] border border-divider bg-background text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground data-[popup-open]:bg-muted/50 data-[popup-open]:text-foreground"
      >
        <Plus aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-52" side="top" sideOffset={10}>
        <DropdownMenuGroup>
          {SOURCES.map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem key={id} onClick={() => onSelect(id)}>
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="flex-1">{label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
