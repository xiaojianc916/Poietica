import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@hybrid-canvas/design-system'
import { ArrowUp, Microphone, Puzzle, Square } from '@mynaui/icons-react'
import { type KeyboardEvent, useRef } from 'react'

import type { AgentDefinition } from '../contracts/agent-contract'
import type { ComposerCommands, ComposerViewModel } from '../contracts/composer-contract'
import { AttachmentMenu } from './AttachmentMenu'
import { AssistantMark } from './primitives/AssistantMark'

export interface AssistantComposerProps {
  readonly model: ComposerViewModel
  readonly commands: ComposerCommands
  readonly agent: AgentDefinition
  readonly placeholder?: string
}

export function AssistantComposer({
  model,
  commands,
  agent,
  placeholder = '接下来我们做点什么？',
}: AssistantComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    commands.submit()
  }

  return (
    <div
      className={cn(
        'group w-full rounded-[18px] border border-divider bg-background',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors',
        'focus-within:border-foreground/25 focus-within:shadow-[0_2px_10px_rgba(15,23,42,0.06)]',
      )}
      onClick={() => textareaRef.current?.focus()}
      onKeyDown={undefined}
    >
      <textarea
        aria-label="AI 输入框"
        className={cn(
          'block max-h-56 min-h-[86px] w-full resize-none bg-transparent',
          'px-4 pt-3.5 pb-1 text-[15px] leading-6 tracking-[-0.006em] text-foreground',
          'outline-none placeholder:text-muted-foreground/70',
        )}
        onChange={(event) => commands.setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={2}
        value={model.draft}
      />

      <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
        <AttachmentMenu onSelect={commands.attach} />

        <button
          aria-label="工具"
          className="grid size-8 place-items-center rounded-[10px] border border-divider bg-background text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          type="button"
        >
          <Puzzle aria-hidden="true" className="size-4" />
        </button>

        <button
          aria-label={`当前 Agent：${agent.name}`}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-[10px] bg-muted/60 pl-2 pr-2.5',
            'text-[13px] font-medium text-foreground transition-colors hover:bg-muted',
          )}
          type="button"
        >
          <AssistantMark className="size-3.5 text-foreground/80" />
          <span className="whitespace-nowrap">{agent.name}</span>
          {agent.badge ? (
            <span className="text-[12px] font-medium text-primary">{agent.badge}</span>
          ) : null}
        </button>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger
            aria-label="语音输入"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            type="button"
          >
            <Microphone aria-hidden="true" className="size-[18px]" />
          </TooltipTrigger>
          <TooltipContent side="top">语音输入</TooltipContent>
        </Tooltip>

        <button
          aria-label={model.isBusy ? '停止生成' : '发送'}
          className={cn(
            'grid size-8 place-items-center rounded-full transition-all',
            model.canSubmit || model.isBusy
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-primary/25 text-primary-foreground/80',
          )}
          disabled={!model.canSubmit && !model.isBusy}
          onClick={model.isBusy ? commands.stop : commands.submit}
          type="button"
        >
          {model.isBusy ? (
            <Square aria-hidden="true" className="size-3" />
          ) : (
            <ArrowUp aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}
