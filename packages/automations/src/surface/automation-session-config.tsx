import type { SessionConfigControl, SessionConfigPurpose } from '@poietica/acp'
import { useAgentControls } from '@poietica/agent-session'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@poietica/ui'
import { useMemo } from 'react'

/*
 * 这条自动化用哪个模型、哪档推理、哪个模式。
 *
 * 一格都不是手写的。清单来自 useAgentControls —— 与输入框上那颗胶囊同一个
 * 产地（agent-capability-store 的全进程单例），所以这里不会出现一个 agent
 * 并不支持的模型，也不需要为了画一个下拉去 spawn 一个 agent 进程。
 *
 * 三个 purpose 就是用户嘴里的三样东西，协议里本来就是一个闭合枚举，不是三
 * 个各写一遍的特例。将来 agent 多报一类（other），它自己会出现在最后一行。
 *
 * 不选＝跟随全局默认。这一格必须存在且必须是默认值：绝大多数自动化不该关心
 * 模型，而一个「被迫选一个」的表单会让人以为不选就跑不起来。
 */

/** 闭合枚举到中文的映射。与 describeTrigger 同一个性质：翻译，不是发明。 */
const PURPOSE_LABELS: Record<SessionConfigPurpose, string> = {
  model: '模型',
  thought: '推理强度',
  mode: '模式',
  other: '其它',
}

const ORDER: readonly SessionConfigPurpose[] = ['model', 'thought', 'mode', 'other']

/*
 * 「跟随默认」在 radio group 里也得有一个值。
 *
 * 用一个不可能与 agent 取值相撞的哨兵，而不是空串 —— 空串是一个合法的
 * 协议取值，拿它当哨兵就等于把某个真实选项永久劫持掉。
 */
const FOLLOW = '\u0000follow-default'

function rank(purpose: SessionConfigPurpose): number {
  const found = ORDER.indexOf(purpose)

  return found < 0 ? ORDER.length : found
}

/*
 * 组内条目不重复组名：与 session-controls 同一条规矩，理由也同一个 ——
 * 上游给取值起名是按「单独出现」起的（kimi-code 的 thinkingOptionName 逐字
 * 是 Thinking 加档位名），而行标签已经说过一遍了。
 */
function labelOf(control: SessionConfigControl, value: string): string {
  const found = control.choices.find((choice) => choice.value === value)

  if (found === undefined) {
    return value
  }

  const prefix = control.label + ' '
  const stripped = found.label.startsWith(prefix) ? found.label.slice(prefix.length) : ''

  return stripped.length > 0 ? stripped : found.label
}

export interface AutomationSessionConfigProps {
  readonly onChange: (controlId: string, value: string | null) => void
  readonly value: Readonly<Record<string, string>>
}

export function AutomationSessionConfig({ onChange, value }: AutomationSessionConfigProps) {
  const controls = useAgentControls()

  /* 排序是投影不是渲染：它只依赖 controls。 */
  const rows = useMemo(
    () => [...controls].sort((left, right) => rank(left.purpose) - rank(right.purpose)),
    [controls],
  )

  if (rows.length === 0) {
    /*
     * 还没有和没有，是两件事。
     *
     * 候选是第一个订阅者出现时才去问的（见 agent-capability-store 的
     * #loadOnce），所以这一格在启动后的头一瞬间必然是空的。画一句话说明它
     * 会自己出现，比画三个空下拉诚实。
     */
    return (
      <p className="text-xs text-muted-foreground">
        还没有拿到 agent 报的可选项。配好 provider
        之后它会自己出现，在此之前这条自动化跟随全局默认。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((control) => (
        <ConfigRow
          control={control}
          key={control.id}
          onChange={onChange}
          picked={value[control.id]}
        />
      ))}
    </div>
  )
}

interface ConfigRowProps {
  readonly control: SessionConfigControl
  readonly onChange: (controlId: string, value: string | null) => void
  readonly picked: string | undefined
}

function ConfigRow({ control, onChange, picked }: ConfigRowProps) {
  /*
   * 存着的取值 agent 现在不报了。
   *
   * 照样显示，并且说出来。静默丢弃是这一类界面最坏的一种失败：人以为设过，
   * 而它一次都没生效过 —— agent-capability-store 的 choose 里那段注释说的
   * 就是同一件事。
   */
  const withdrawn =
    picked !== undefined && !control.choices.some((choice) => choice.value === picked)

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{PURPOSE_LABELS[control.purpose]}</span>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={PURPOSE_LABELS[control.purpose]}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground transition-colors hover:bg-sidebar-accent"
        >
          <span className="truncate">
            {picked === undefined ? '跟随默认' : labelOf(control, picked)}
          </span>
          {withdrawn ? <span className="text-destructive">·</span> : null}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-44" sideOffset={4}>
          <DropdownMenuRadioGroup
            onValueChange={(next) => {
              onChange(control.id, next === FOLLOW ? null : next)
            }}
            value={picked ?? FOLLOW}
          >
            <DropdownMenuRadioItem value={FOLLOW}>
              <span className="flex-1">跟随默认</span>
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>

            {control.choices.map((choice) => (
              <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                <span className="flex-1">{labelOf(control, choice.value)}</span>
                <DropdownMenuRadioItemIndicator />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
