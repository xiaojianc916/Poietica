import type { SessionConfigControl } from '@poietica/acp'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@poietica/ui'
import { memo, useMemo } from 'react'

/*
 * Everything the session lets us change, in one control.
 *
 * 一级列 purpose、二级列取值。一级菜单的行数等于可调维度数，与取值总数解耦，
 * 新增模型不会把菜单撑到屏幕外；当前值在一级行右侧直接可读，不必逐段扫描勾选。
 *
 * 子菜单用设计系统导出的 Base UI Menu.SubmenuRoot：悬停延迟、安全三角、方向键
 * 进出、Escape 逐级关闭、焦点归还都是标准的职责。Portal 由 DropdownMenuSubContent
 * 自己带，与 DropdownMenuContent 对称，调用处不需要知道它存在；portal 之后皮肤属性
 * 必须挂在弹层自身，后代选择器够不到 body 下的节点——这正是此前菜单是裸默认皮肤的
 * 原因。
 */

/*
 * 读不到和还没有，是两件事。
 *
 * 还没有就是还没有：选择器属于会话，会话属于对话，一条还没说过话的对话没有
 * 会话，也就没有什么可选。这种时候整块不渲染。此前那里是一颗写着「会话未就
 * 绪」的灰药丸：一个没有 onClick 的 span，键盘走不到、焦点挂不住，用户从那
 * 四个字里读不出该等还是该点，而 model / mode / thought 的位置被它占着。没
 * 有的东西不画,是这一格唯一诚实的形态。
 *
 * 连不上是另一回事，它是一次真的失败，所以它说出原因并且可以被再试一次：
 * 「agent 没装起来」「握手失败」「一轮回答正在跑」都落在这里，标题上写的是原生
 * 侧给出的那一句，而不是一句无从下手的"读取失败"。 */
const UNAVAILABLE = '没连上 agent，点击重试'

const ORDER: readonly string[] = ['model', 'thought', 'other']

/** Where a purpose sits; anything unrecognised sorts last rather than away. */
function rank(purpose: SessionConfigControl['purpose']): number {
  const found = ORDER.indexOf(purpose)

  return found < 0 ? ORDER.length : found
}

/** The name the agent gave the value in force, falling back to the value. */
function chosen(control: SessionConfigControl): string {
  return (
    control.choices.find((choice) => choice.value === control.current)?.label ?? control.current
  )
}

/*
 * 正在回答时，模型选择器不禁用。
 *
 * 上游 kimi-code 的 performModelSwitch 第一行判 streamingPhase，那是终端程序的前提：
 * 一个进程只有一条会话，「正在流式」与「这一条正在流式」是同一件事。我们能同时开
 * 多条，而选中的模型是全局那一份（config.toml 的 default_model）—— 拿某一格的忙碌
 * 去灰掉一个全局设置，既拦不住在别的对话里改，又会在正跑的这一格误伤。主语就不对。
 *
 * 该推迟的不是人的动作，是下发：正在跑的那条会话空下来之后由 ThreadsStore 补发
 * （threads-store 的 #align 与 TranscriptSink.onIdle）。界面因此一格都不灰。
 */

export interface SessionControlsProps {
  readonly controls: readonly SessionConfigControl[]
  readonly failure?: string | undefined
  readonly onSelect: (controlId: string, value: string) => void
  /** 失败之后再打开一次；没有这个，失败就是一条死路。 */
  readonly onRetry?: (() => void) | undefined
}

/*
 * 记住不重建。
 *
 * 同层的 AssistantSurface、AssistantComposer、ThreadRow 都有这道边界，这一格
 * 此前没有 —— 管线不统一。它的入参只有 controls 会变，而 controls 只在换模型
 * 时才换引用；它下面是一个菜单根加 N 个子菜单根，白重建一次的代价远不止下面
 * 那几次数组分配。
 */
export const SessionControls = memo(function SessionControls({
  controls,
  failure,
  onRetry,
  onSelect,
}: SessionControlsProps) {
  /*
   * 模式不在这一格。
   *
   * 它归加号那一侧,并且在那里留下一颗可摘的胶囊。同一件事只许有一个所有者:
   * 两处各画一次当前值,改一处另一处不跟,而且用户会以为那是两个东西。
   *
   * Sorting is stable, so the agent order survives inside each purpose.
   */
  /*
   * 排序是投影，不是渲染。
   *
   * 一次复制、一次过滤、一次排序、一次查找，此前每次渲染都做一遍。
   * prompt-input.tsx 顶上那段注释已经点过它的名，但那次只收窄了触发次数，
   * 没有把它挪出渲染路径 —— 它依赖的只有 controls。
   */
  const rows = useMemo(
    () =>
      [...controls]
        .filter((control) => control.purpose !== 'mode')
        .sort((left, right) => rank(left.purpose) - rank(right.purpose)),
    [controls],
  )

  const model = useMemo(() => controls.find((control) => control.purpose === 'model'), [controls])

  /* 析构判空同时给出空状态判据与首行，索引访问不再需要断言。 */
  const [firstRow] = rows

  if (firstRow === undefined) {
    /* 还没有会话，就没有这一格：第一句话开出会话，选择器自己出现。 */
    if (failure === undefined) {
      return null
    }

    /* 连不上：说出原因，并且让它可以被再试一次。 */
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
        <span className="assistant-model-select__label">{UNAVAILABLE}</span>
      </button>
    )
  }

  return (
    <DropdownMenu>
      {/*
        连不上 agent 这件事不在这里说了。
      
        它归转录里那条横线：报错只有那一种形态，不因为它从哪条路来而换长相。
        留在这里还有第二重坏处 —— 紧挨着 Model 和 Thinking 两行，读起来就是这两项
        坏了。下面那个空态分支仍然用 failure：那是一格什么都没有的时候，唯一的
        出口。
      */}
      {/*
        这颗胶囊只说一件事：下一轮由谁来答。

        厂商标此前挂在名字左边，而名字本身已经把厂商说清楚了 —— 一个标记只在它
        补充了文字没说的东西时才值一格宽度。空态那一支同去：同一颗控件不该因为
        连不上就多长出一枚图标。开场那枚大标记不受影响，它是另一处。
      */}
      <DropdownMenuTrigger aria-label="会话设置" className="assistant-model-select__button">
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

            <DropdownMenuSubContent
              align="start"
              className="assistant-config-menu__submenu assistant-menu-surface"
              data-assistant-skin
              side="left"
            >
              {/*
                一组互斥的取值就是一个 radio group。
              
                选中态由 Base UI 维护，勾只在生效的那一行挂载，
                role="menuitemradio"、aria-checked、方向键与打字选中一并由它
                给出。此前是普通 item 加一个 data-active：样式表里那条画好的
                ::indicator 规则等着一个从未被渲染的元素，而 data-active 等着
                一条从未存在的规则——两边各写了一半，勾因此一次都没画出来。
              */}
              <DropdownMenuRadioGroup
                onValueChange={(value) => {
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
                    key={choice.value}
                    value={choice.value}
                  >
                    <span className="assistant-config-option__label">{choice.label}</span>

                    {choice.detail === undefined ? null : (
                      <span className="assistant-config-option__detail">{choice.detail}</span>
                    )}

                    <DropdownMenuRadioItemIndicator className="assistant-config-option__indicator" />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
