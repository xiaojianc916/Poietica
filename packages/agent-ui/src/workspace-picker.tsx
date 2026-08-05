import './styles/assistant.css'

import { ChevronRight } from '@mynaui/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@poietica/ui'

/*
 * 当前的工作目录，以及换一个。
 *
 * 这一层不认识文件系统，也不认识 Tauri：目录选择器是宿主的能力，从 onBrowse
 * 进来（架构规则 nativeAllowed 只放行 desktop / desktop-adapters / ipc）。
 *
 * 「最近」不是一份新名单。已经有对话的工作区就是最近用过的工作区，而那份分组
 * 侧栏本来就在画（agent-session 的 groupByWorkspace）—— 所以它从 props 进来，
 * 不新开存储，也不会有第二份会跟真相分叉的记录。
 *
 * 当前那一个不出现在菜单里：触发器上写着的就是它，再列一遍只是一个点了没有
 * 反应的选项。名字缺席的那一组也不出现 —— 那一组说的是「目录没被记下来」，
 * 它不是一个可以切过去的地方。
 */

/** 一个可以切过去的工作区：id 是绝对路径，name 是它最后一段。 */
export interface WorkspaceChoice {
  readonly id: string
  readonly name: string
}

export interface WorkspacePickerProps {
  /** 此刻在哪个工作目录里。还没选过就是 null。 */
  readonly current: WorkspaceChoice | null
  readonly choices: readonly WorkspaceChoice[]
  readonly onChoose: (rootPath: string) => void
  /** 开系统的文件夹选择器。这一层不知道那是怎么开的。 */
  readonly onBrowse: () => void
}

export function WorkspacePicker({ choices, current, onBrowse, onChoose }: WorkspacePickerProps) {
  const others = choices.filter((choice) => choice.id !== current?.id)

  return (
    <div className="workspace-picker" data-assistant-skin>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label="工作目录"
          className="workspace-picker__button"
          title={current?.id}
        >
          <span className="workspace-picker__name">{current?.name ?? '选择工作目录'}</span>

          <span aria-hidden="true" className="workspace-picker__chevron">
            <ChevronRight aria-hidden="true" />
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="workspace-picker__menu assistant-menu-surface"
          data-assistant-skin
          side="bottom"
          sideOffset={4}
        >
          <DropdownMenuItem className="workspace-picker__item" onClick={onBrowse}>
            打开文件夹…
          </DropdownMenuItem>

          {others.length === 0 ? null : (
            <>
              <DropdownMenuSeparator className="workspace-picker__separator" />

              {others.map((choice) => (
                <DropdownMenuItem
                  className="workspace-picker__item"
                  key={choice.id}
                  onClick={() => {
                    onChoose(choice.id)
                  }}
                  title={choice.id}
                >
                  <span className="workspace-picker__name">{choice.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
