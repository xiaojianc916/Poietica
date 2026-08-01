import type { RegisteredCommand } from '@poietica/workspace/contracts'

export interface CommandRegistry {
  readonly register: (command: RegisteredCommand) => () => void
  readonly execute: (commandId: string) => Promise<boolean>
  readonly get: (commandId: string) => RegisteredCommand | undefined
  readonly getSnapshot: () => readonly RegisteredCommand[]
  readonly subscribe: (listener: () => void) => () => void
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, RegisteredCommand>()
  const listeners = new Set<() => void>()
  let snapshot: readonly RegisteredCommand[] = []

  function emit(): void {
    snapshot = Array.from(commands.values()).sort(compareCommands)
    for (const listener of listeners) {
      listener()
    }
  }

  function register(command: RegisteredCommand): () => void {
    if (commands.has(command.id)) {
      throw new Error(`COMMAND_ALREADY_REGISTERED: ${command.id}`)
    }

    commands.set(command.id, command)
    emit()

    let registered = true
    return () => {
      if (!registered) {
        return
      }
      registered = false
      commands.delete(command.id)
      emit()
    }
  }

  async function execute(commandId: string): Promise<boolean> {
    const command = commands.get(commandId)
    if (!command) {
      return false
    }
    await command.execute()
    return true
  }

  return {
    register,
    execute,
    get(commandId) {
      return commands.get(commandId)
    },
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function compareCommands(left: RegisteredCommand, right: RegisteredCommand): number {
  const categoryOrder = (left.category ?? '').localeCompare(right.category ?? '')
  return categoryOrder || left.label.localeCompare(right.label)
}
