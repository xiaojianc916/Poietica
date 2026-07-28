import { Command } from '@mynaui/icons-react'
import type { RegisteredCommand } from '@poietica/features-workspace'
import type { CommandRegistry } from '@poietica/features-workspace/application'
import { CommandMenu, type CommandMenuItem, Dialog } from '@poietica/foundations-design-system'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { formatKeybinding } from './keybinding'

export interface CommandPaletteProps {
  readonly open: boolean
  readonly registry: CommandRegistry
  readonly onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, registry, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('')

  const commands = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  )

  const filteredCommands = useMemo(() => filterCommands(commands, query), [commands, query])

  const items = useMemo<readonly CommandMenuItem[]>(
    () =>
      filteredCommands.map((command) => ({
        value: command.id,
        label: command.label,
        ...(command.category !== undefined
          ? {
              category: command.category,
            }
          : {}),
        ...(command.shortcut === undefined
          ? {}
          : {
              shortcut: formatKeybinding(command.shortcut),
            }),
        leading: <Command aria-hidden="true" className="size-4" />,
      })),
    [filteredCommands],
  )

  useEffect(() => {
    if (open) {
      setQuery('')
    }
  }, [open])

  const executeCommand = (commandId: string) => {
    const command = commands.find((candidate) => candidate.id === commandId)

    if (!command) {
      return
    }

    onOpenChange(false)

    void registry.execute(command.id)
  }

  return (
    <Dialog
      className="max-w-xl"
      contentClassName="overflow-hidden"
      description="搜索并执行工作区命令"
      onOpenChange={onOpenChange}
      open={open}
      title="命令面板"
    >
      <CommandMenu
        ariaLabel="搜索命令"
        items={items}
        onQueryChange={setQuery}
        onSelect={executeCommand}
        query={query}
      />
    </Dialog>
  )
}

function filterCommands(
  commands: readonly RegisteredCommand[],
  query: string,
): readonly RegisteredCommand[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  if (!normalizedQuery) {
    return commands
  }

  return commands.filter((command) => {
    const searchableText = [command.category ?? '', command.label, command.id]
      .join(' ')
      .toLocaleLowerCase()

    return searchableText.includes(normalizedQuery)
  })
}
