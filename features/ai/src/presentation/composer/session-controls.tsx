import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'

import type { SessionConfigControl } from '../../contracts/session-config-contract'
import { ProviderIcon } from '../primitives/provider-icon'

/*
 * 会话能改的每一项,一个入口,两级菜单。
 *
 * 一级是选择器本身:一行一个,右侧写着当前生效的值;二级才是取值列表。这是
 * 桌面软件菜单的通行做法 —— 一级可扫读,二级按需展开,菜单高度不随取值个数
 * 膨胀。上一版把三个选择器的全部取值平铺在同一个面板里,行数由代理返回多少
 * 个模型决定,于是只有两三个取值的 Thinking / Mode 被埋在十几行之后。
 *
 * 子菜单用设计系统的 DropdownMenuSub(底层是 Base UI 的 Menu.SubmenuRoot):
 * 方向键、悬停意图的安全三角、Escape 逐层关闭、焦点归位,都是标准的职责,
 * 不是这个文件的。上一版留下的手写子菜单定位、过桥条与旋转箭头已随之删除。
 *
 * 面板与子面板都要带 data-assistant-skin:它们是 Portal 渲染到 body 的,
 * 不在 AI 界面的子树里,皮肤令牌只能由它们自己携带。
 */

const NOTHING_TO_OFFER = '会话未就绪'

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
}

export function SessionControls({ controls, failure, onSelect }: SessionControlsProps) {
  /* Sorting is stable, so the agent order survives inside each purpose. */
  const rows = [...controls].sort((left, right) => rank(left.purpose) - rank(right.purpose))
  const model = controls.find((control) => control.purpose === 'model')
  const provider = model?.current.split('/')[0]

  /* 析构判空同时给出空状态判据与首行,索引访问不再需要断言。 */
  const [firstRow] = rows

  if (firstRow === undefined) {
    return (
      <span
        aria-live="polite"
        className="assistant-model-select__button"
        data-empty="true"
        title={failure}
      >
        <ProviderIcon />

        <span className="assistant-model-select__label">{NOTHING_TO_OFFER}</span>
      </span>
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
        {rows.map((control) => (
          <DropdownMenuSub key={control.id}>
            <DropdownMenuSubTrigger className="assistant-config-menu__row">
              <span className="assistant-config-menu__row-label">{control.label}</span>

              <span className="assistant-config-menu__row-value">{chosen(control)}</span>
            </DropdownMenuSubTrigger>

            {/* 子面板要自己进 Portal:SubContent 只是 Positioner + Popup。 */}
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                align="start"
                className="assistant-config-menu__submenu assistant-menu-surface"
                data-assistant-skin
                side="left"
              >
                {/*
                  One value is in force per selector, which is a radio group and
                  not a list of commands: the group owns the value, the role and
                  aria-checked, and it mounts the indicator on the row that
                  matches. The guard stays because a group promises a value, not
                  a change, and re-sending the value in force would be a request
                  to the agent for nothing.
                */}
                <DropdownMenuRadioGroup
                  onValueChange={(value: string) => {
                    if (value === control.current) {
                      return
                    }

                    onSelect(control.id, value)
                  }}
                  value={control.current}
                >
                  {control.choices.map((choice) => (
                    <DropdownMenuRadioItem
                      className="assistant-config-option"
                      closeOnClick
                      key={choice.value}
                      value={choice.value}
                    >
                      <DropdownMenuRadioItemIndicator className="assistant-config-option__indicator" />

                      <span className="assistant-config-option__label">{choice.label}</span>

                      {choice.detail === undefined ? null : (
                        <span className="assistant-config-option__detail">{choice.detail}</span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
