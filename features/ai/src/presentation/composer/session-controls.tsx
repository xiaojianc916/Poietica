import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'

import type { SessionConfigControl } from '../../contracts/session-config-contract'
import { ProviderIcon } from '../primitives/provider-icon'

/*
 * Everything the session lets us change, in one control.
 *
 * 一级列 purpose、二级列取值。一级菜单的行数等于可调维度数，与取值总数解耦，
 * 新增模型不会把菜单撑到屏幕外；当前值在一级行右侧直接可读，不必逐段扫描勾选。
 *
 * 子菜单用设计系统导出的 Base UI Menu.SubmenuRoot：悬停延迟、安全三角、方向键
 * 进出、Escape 逐级关闭、焦点归还都是标准的职责。DropdownMenuSubContent 不自带
 * Portal，因此显式包 DropdownMenuPortal；portal 之后皮肤属性必须挂在弹层自身，
 * 后代选择器够不到 body 下的节点——这正是此前菜单是裸默认皮肤的原因。
 */

const NOTHING_TO_OFFER = '会话未就绪'

/*
 * 读不到和还没有，是两件事。
 *
 * 之前两者都渲染成同一段不可点击的文字，于是「agent 没装起来」「握手失败」
 * 「一轮回答正在跑」这三种完全不同的处境，在屏幕上长得一模一样，而唯一的
 * 说明藏在一个挂不住焦点的 title 里。
 */
const UNAVAILABLE = '会话设置读取失败，点击重试'

const ORDER = ['model', 'thought', 'mode', 'other'] as const

/** Where a purpose sits; anything unrecognised sorts last rather than away. */
function rank(purpose: SessionConfigControl['purpose']): number {
  const found = ORDER.indexOf(purpose as (typeof ORDER)[number])

  return found < 0 ? ORDER.length : found
}

/** The name the agent gave the value in force, falling back to the value. */
function chosen(control: SessionConfigControl): string {
  return (
    control.choices.find((choice) => choice.value === control.current)?.label ?? control.current
  )
}

export interface SessionControlsProps {
  readonly controls: readonly SessionConfigControl[]
  readonly failure?: string | undefined
  readonly onSelect: (controlId: string, value: string) => void
  /** 读失败之后重新问一次；没有这个，失败就是一条死路。 */
  readonly onRetry?: (() => void) | undefined
}

export function SessionControls({ controls, failure, onRetry, onSelect }: SessionControlsProps) {
  /* Sorting is stable, so the agent order survives inside each purpose. */
  const rows = [...controls].sort((left, right) => rank(left.purpose) - rank(right.purpose))
  const model = controls.find((control) => control.purpose === 'model')
  const provider = model?.current.split('/')[0]

  /* 析构判空同时给出空状态判据与首行，索引访问不再需要断言。 */
  const [firstRow] = rows

  if (firstRow === undefined) {
    /* 还没有会话：等一下就有了，这里没有什么可做的。 */
    if (failure === undefined) {
      return (
        <span aria-live="polite" className="assistant-model-select__button" data-empty="true">
          <ProviderIcon />

          <span className="assistant-model-select__label">{NOTHING_TO_OFFER}</span>
        </span>
      )
    }

    /* 读失败了：说出原因，并且让它可以被再试一次。 */
    return (
      <button
        aria-live="polite"
        className="assistant-model-select__button"
        data-empty="true"
        data-failed="true"
        onClick={onRetry}
        title={failure}
        type="button"
      >
        <ProviderIcon />

        <span className="assistant-model-select__label">{UNAVAILABLE}</span>
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="会话设置"
        className="assistant-model-select__button"
        title={failure}
      >
        <ProviderIcon {...(provider === undefined || provider === '' ? {} : { provider })} />

        <span className="assistant-model-select__label">{chosen(model ?? firstRow)}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="assistant-config-menu__panel assistant-menu-surface"
        data-assistant-skin
        side="top"
        sideOffset={6}
      >
        {failure === undefined ? null : (
          <div className="assistant-config-menu__row" role="alert">
            <span className="assistant-config-menu__row-label">{failure}</span>
          </div>
        )}

        {rows.map((control) => (
          <DropdownMenuSub key={control.id}>
            <DropdownMenuSubTrigger className="assistant-config-menu__row">
              <span className="assistant-config-menu__row-label">{control.label}</span>

              <span className="assistant-config-menu__row-value">{chosen(control)}</span>
            </DropdownMenuSubTrigger>

            <DropdownMenuPortal>
              <DropdownMenuSubContent
                align="start"
                className="assistant-config-menu__submenu assistant-menu-surface"
                data-assistant-skin
                side="left"
              >
                {/* onClick 才是 Base UI Menu.Item 的回调；onSelect 是文本选中事件，永不触发。 */}
                {control.choices.map((choice) => (
                  <DropdownMenuItem
                    className="assistant-config-option"
                    data-active={choice.value === control.current ? 'true' : undefined}
                    key={choice.value}
                    onClick={() => {
                      if (choice.value === control.current) {
                        return
                      }

                      onSelect(control.id, choice.value)
                    }}
                  >
                    <span className="assistant-config-option__label">{choice.label}</span>

                    {choice.detail === undefined ? null : (
                      <span className="assistant-config-option__detail">{choice.detail}</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
