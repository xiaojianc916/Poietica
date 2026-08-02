export interface UICommand {
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  readonly when?: string
  readonly category?: string
}

export interface UICommandHandler {
  readonly command: UICommand
  execute(): void | Promise<void>
}

export interface RegisteredCommand extends UICommand {
  readonly execute: () => void | Promise<void>
}
