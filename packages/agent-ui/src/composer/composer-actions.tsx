import type { SessionConfigControl } from '@poietica/agent-contract'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@poietica/ui'
import { type ComponentType, memo, useMemo } from 'react'
import {
  AgentIcon,
  AttachIcon,
  CheckIcon,
  CloseIcon,
  GlobeIcon,
  ModelIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ThinkingIcon,
  ThreadIcon,
  ToolIcon,
} from '../primitives/icons'
import { usePromptInputActions } from './prompt-input'

/*
 * 加号那一侧：往这一句里加什么，以及这一句怎么被处理。
 *
 * 上组是模式，下组是能力。两组都不是这里编出来的：模式是 agent 在
 * session/new 里报的 purpose === 'mode' 的那个 selector，其余能力（skills、
 * MCP 之类）是它报的 purpose === 'other'。agent 没报就没有那一行 —— 画一行
 * 点不动的灰字，等于告诉用户"这里坏了"。
 *
 * 「添加文件」是唯一一条不来自 agent 的行，因为它不属于 agent：文件由输入框
 * 自己持有（PromptInput 的 openFilePicker）。
 *
 * 弹层行为全部归 Base UI（设计系统的 DropdownMenu）：Portal、方向键、打字
 * 选中、Esc 逐级关闭、焦点归还。这里只给皮肤与几何。
 */

/** 图标槽位的最小 props 契约：只声明调用点真正会传的属性。
 *  放宽到 React 的完整 SVG props 会在 exactOptionalPropertyTypes 下
 *  与图标库的 props 发生逆变冲突。 */
type GlyphProps = {
  'aria-hidden'?: 'true'
  className?: string
}

type Glyph = ComponentType<GlyphProps>

/*
 * 模式的字形。
 *
 * id 由 agent 自己取名，所以识别是可选的、缺省必须成立 —— 与
 * primitives/provider-icon-source.ts 同一种做法，不是第二套。
 */
const MODE_GLYPH: Readonly<Record<string, Glyph>> = {
  architect: ThinkingIcon,
  ask: ThreadIcon,
  auto: AgentIcon,
  browse: GlobeIcon,
  code: PencilIcon,
  debug: ToolIcon,
  edit: PencilIcon,
  plan: ThinkingIcon,
  research: SearchIcon,
  search: SearchIcon,
  yolo: ToolIcon,
}

function glyphOf(value: string): Glyph {
  return MODE_GLYPH[value.toLowerCase()] ?? ModelIcon
}

function labelOf(control: SessionConfigControl): string {
  return (
    control.choices.find((choice) => choice.value === control.current)?.label ?? control.current
  )
}

export interface ComposerActionsProps {
  readonly controls: readonly SessionConfigControl[]
  readonly onSelectControl: (controlId: string, value: string) => void
}

/*
 * 记住不重建，与右下那一簇同一条规矩。
 *
 * SessionControls 已经有这道边界，左边这一簇同样的形状漏了 —— 同一份入参、同一
 * 种分流、同样是一个菜单根加 N 个子菜单根。两处同构的东西不该只有一处有边界，
 * 那正是「新旧杂糅」的起点。controls 只在换模型或换模式时才换引用。
 */
export const ComposerActions = memo(function ComposerActions({
  controls,
  onSelectControl,
}: ComposerActionsProps) {
  /* 这一整棵菜单要的只是「打开文件选择器」，所以它不该随草稿重建。 */
  const { openFilePicker } = usePromptInputActions()

  /* 分流是投影，不是渲染：一次 find、一次 filter，只依赖 controls。 */
  const mode = useMemo(() => controls.find((control) => control.purpose === 'mode'), [controls])

  const extras = useMemo(
    () => controls.filter((control) => control.purpose === 'other'),
    [controls],
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="添加内容" className="assistant-control--ghost">
          <PlusIcon aria-hidden="true" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="assistant-plus-menu assistant-menu-surface"
          data-assistant-skin
          side="top"
          sideOffset={6}
        >
          {mode === undefined ? null : (
            <DropdownMenuRadioGroup
              className="assistant-plus-menu__group"
              onValueChange={(value) => {
                if (value === mode.current) {
                  return
                }
                onSelectControl(mode.id, value)
              }}
              value={mode.current}
            >
              {mode.choices.map((choice) => {
                const Mark = glyphOf(choice.value)

                return (
                  <DropdownMenuRadioItem
                    className="assistant-plus-menu__item"
                    key={choice.value}
                    value={choice.value}
                  >
                    <Mark aria-hidden="true" />

                    <span className="assistant-plus-menu__label">{choice.label}</span>

                    <DropdownMenuRadioItemIndicator className="assistant-plus-menu__tick">
                      <CheckIcon aria-hidden="true" />
                    </DropdownMenuRadioItemIndicator>
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          )}

          <div className="assistant-plus-menu__group">
            <DropdownMenuItem className="assistant-plus-menu__item" onClick={openFilePicker}>
              <AttachIcon aria-hidden="true" />

              <span className="assistant-plus-menu__label">添加文件</span>

              <kbd className="assistant-plus-menu__hint">Ctrl+U</kbd>
            </DropdownMenuItem>

            {extras.map((control) => (
              <DropdownMenuSub key={control.id}>
                <DropdownMenuSubTrigger className="assistant-plus-menu__item">
                  <ToolIcon aria-hidden="true" />

                  <span className="assistant-plus-menu__label">{control.label}</span>
                </DropdownMenuSubTrigger>

                <DropdownMenuSubContent
                  align="start"
                  className="assistant-plus-menu assistant-menu-surface"
                  data-assistant-skin
                  side="right"
                >
                  <DropdownMenuRadioGroup
                    className="assistant-plus-menu__group"
                    onValueChange={(value) => {
                      if (value === control.current) {
                        return
                      }
                      onSelectControl(control.id, value)
                    }}
                    value={control.current}
                  >
                    {control.choices.map((choice) => (
                      <DropdownMenuRadioItem
                        className="assistant-plus-menu__item"
                        key={choice.value}
                        value={choice.value}
                      >
                        <span className="assistant-plus-menu__label">{choice.label}</span>

                        {choice.detail === undefined ? null : (
                          <span className="assistant-plus-menu__detail">{choice.detail}</span>
                        )}

                        <DropdownMenuRadioItemIndicator className="assistant-plus-menu__tick">
                          <CheckIcon aria-hidden="true" />
                        </DropdownMenuRadioItemIndicator>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {mode === undefined ? null : <ModePill control={mode} onSelect={onSelectControl} />}
    </>
  )
})

/*
 * 选中之后留下的那一颗。
 *
 * 只有偏离默认值时才有胶囊：胶囊说的是"这一句和平常不一样"，而 ACP 里模式恒
 * 有一个在生效，所以"摘掉"只能是回到默认，不能是回到没有模式 —— 画一颗能被
 * 删成"无模式"的胶囊，是在对用户撒谎。
 *
 * 标记位本身就是那颗按钮：它恒定可交互，:hover 只换它显示哪一个图标。可点
 * 与否绝不随指针状态漂移 —— 那样会让按下与抬起落在不同元素上，click 因此
 * 派发给公共祖先而不是按钮，键盘那一路也一并断掉。
 */
function ModePill({
  control,
  onSelect,
}: {
  readonly control: SessionConfigControl
  readonly onSelect: (controlId: string, value: string) => void
}) {
  const [fallback] = control.choices

  if (fallback === undefined || control.current === fallback.value) {
    return null
  }

  const Mark = glyphOf(control.current)
  const label = labelOf(control)

  return (
    <span className="assistant-mode-pill" data-mode={control.current.toLowerCase()}>
      <button
        aria-label={`退出${label}`}
        className="assistant-mode-pill__mark"
        onClick={() => {
          onSelect(control.id, fallback.value)
        }}
        type="button"
      >
        <Mark aria-hidden="true" className="assistant-mode-pill__glyph" />

        <CloseIcon aria-hidden="true" className="assistant-mode-pill__cross" />
      </button>

      <span className="assistant-mode-pill__label">{label}</span>
    </span>
  )
}
