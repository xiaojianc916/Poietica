import type { CommandRegistry } from '@poietica/features-workspace/application'
import { useEffect } from 'react'

export interface CommandShortcutBinding {
  readonly key: string
  readonly commandId: string
  readonly ctrlOrMeta?: boolean
}

export function useGlobalCommandShortcuts(
  registry: CommandRegistry,
  bindings: readonly CommandShortcutBinding[],
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const binding = bindings.find(
        (candidate) =>
          candidate.key.toLocaleLowerCase() === event.key.toLocaleLowerCase() &&
          (candidate.ctrlOrMeta === undefined ||
            candidate.ctrlOrMeta === (event.ctrlKey || event.metaKey)),
      )
      if (!binding) {
        return
      }
      event.preventDefault()
      void registry.execute(binding.commandId)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bindings, registry])
}
