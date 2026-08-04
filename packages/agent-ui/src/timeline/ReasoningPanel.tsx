import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import { ChevronDownIcon, ThinkingIcon } from '../primitives/icons'
import { useDevicePixels } from '../primitives/use-device-pixels'
import { ProseSegment } from './Prose'
import { createBlockScanner } from './split-stream'

export interface ReasoningPanelProps {
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * 一个逻辑行的估高：安静档字号（--ui-prose-size-quiet）乘行高，约 19px。
 *
 * 它是下界，不是预测 —— 一行文字换行之后只会更高。按转录那一层这张估高表自己声明
 * 的口径：「估小了只是补偿一次，估大了会在到达前留白」，下界落在安全的那一侧。
 */
const ESTIMATED_LINE_PX = 19

/** 视口之外预留的块数。块比转录的行小得多，四块盖得住一次滚轮的位移。 */
const OVERSCAN_BLOCKS = 4

/**
 * 距末端多近算作「仍在看最新一行」。
 *
 * 这个数是自动跟随的唯一判据（scrollEndThreshold 同时喂给 followOnAppend 与末端锚定
 * 的增量补偿），所以它有下界也有上界：必须大于一帧的长高（一行 19px 加一个段间距），
 * 否则内容刚越过高度上限的那一刻跟随接不上；必须小于一格滚轮（转录那一层取 48），
 * 否则人往上拨一格还被判成贴底，放手也就不成立。
 */
const BOTTOM_THRESHOLD_PX = 32

/**
 * The thought chain.
 *
 * Not a card: a card would give a passing remark the same weight as an answer.
 * One quiet line that can be opened, and the thinking underneath it — rendered
 * by the same pipeline as the answer, because it is the same kind of content.
 *
 * 正在思考时展开，思考完毕收起；人点过一次之后以人为准。判据与工具卡片同一个，
 * 语义写在 useDisclosure。
 *
 * The prose is always mounted: unmounting it is why the panel used to snap
 * open, as there is nothing to animate between a node and no node. It lives in
 * a grid row that travels between 0fr and 1fr, the one way an intrinsic height
 * animates without being measured in script. Closed, the row is inert, so its
 * content is out of reach of the keyboard and of a screen reader.
 *
 * A long chain scrolls within a capped box rather than pushing the answer down
 * the page. The cap is a maximum, so a short chain has no scroller and no
 * scrollbar at all.
 *
 * 而这个盒子此前只有高度封了顶，内容没有：一条长思考链整篇常驻挂载 —— 每行代码一个
 * span、每个词一个 [data-sd-animate] —— 而屏幕上只有二十来行。「高度有上限、内容量
 * 无上限、只有一个窗口可见」正是虚拟化的定义性场景，所以这里就是虚拟列表，用的是
 * 转录那一层同一个虚拟器、同一套末端锚定原语。
 *
 * 滚动位置因此只有一个所有者。此前它有两个：转录归虚拟器，这个盒子归一个自写的
 * hook（一个 ResizeObserver 加一次 rAF 分帧再加一次 scrollTop 赋值）。那套东西每
 * 一件都对，但同一个问题不该有两个答案 —— 那个 hook 连同它的文件已经删掉，不留
 * 兼容层。
 *
 * 一块 markdown 就是一行。切分归 createBlockScanner，渲染归 ProseSegment，两者与回答
 * 条流完全同款；这一层只回答「哪些块此刻在屏幕上」。
 */
export function ReasoningPanel({ isStreaming, text }: ReasoningPanelProps) {
  const { isOpen, toggle } = useDisclosure(isStreaming)

  /*
   * 一次线性扫描，没有解析：切点只看行首字符与围栏配平。
   *
   * 封口的块内容不再变，所以每一块正好被解析一次；正在写的那一块是最后一块。
   */
  const [split] = useState(createBlockScanner)

  const blocks = useMemo(() => split(text), [split, text])

  /*
   * 本帧的块表，给虚拟器的选项函数同步读。
   *
   * 理由与 AgentActivityFeed 的 rowsRef 逐字相同：官方要求把 getItemKey 与
   * estimateSize memo 住，而块表每一帧换引用，写进依赖数组等于没有 memo。这一处
   * 与那一处是同一个待偿项（React 官方不建议渲染期读写 ref），所以做法保持一致，
   * 将来一起换掉，而不是在这里另立第二种。
   */
  const blocksRef = useRef(blocks)

  blocksRef.current = blocks

  const scrollRef = useRef<HTMLDivElement | null>(null)

  /* 落点要踩在设备像素上：半个像素会把块里 1px 的边摊到两行、墨色减半。 */
  const snapToDevicePixels = useDevicePixels()

  /*
   * 身份是块的起始行号。
   *
   * 块只追加，封口之后内容不再变，所以这个数恒定且唯一 —— 而且正在写的那一块封口
   * 时它的起始行号不变，于是它已经测到的高度不会因为「它现在算封口的了」而作废。
   */
  const getItemKey = useCallback((index: number) => blocksRef.current[index]?.key ?? index, [])

  const estimateSize = useCallback((index: number) => {
    const block = blocksRef.current[index]

    return block === undefined ? ESTIMATED_LINE_PX : block.lines * ESTIMATED_LINE_PX
  }, [])

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    /*
     * 这个盒子的稳定侧永远是末端，与转录那一层同一个立场。
     *
     * 「内容长高时若人还贴在末端就跟随，人往上滚就放手，滚回末端就重新接管」——
     * 这三句话不需要在产品代码里复刻：末端锚定负责最后一块长高时的增量补偿，
     * followOnAppend 负责新块追加时的跟随，scrollEndThreshold 负责判「够不够近」。
     */
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: BOTTOM_THRESHOLD_PX,
    overscan: OVERSCAN_BLOCKS,
    /* 单引擎渲染器（WebView2），原生 scrollend 可用；理由见 AgentActivityFeed 同一处。 */
    useScrollendEvent: true,
  })

  const items = virtualizer.getVirtualItems()
  const live = blocks.length - 1

  /*
   * 打开一个正在写的思考，看到的是最新那一行。
   *
   * 只做一次，此后贴底与否由 scrollEndThreshold 判 —— 这里不记第二本账。收起或写完
   * 之后闩锁复位，下一次「边写边打开」仍然成立。
   */
  const jumped = useRef(false)

  useLayoutEffect(() => {
    if (!isOpen || !isStreaming) {
      jumped.current = false
      return
    }

    if (jumped.current) {
      return
    }

    jumped.current = true
    virtualizer.scrollToEnd()
  }, [isOpen, isStreaming, virtualizer])

  return (
    <div className="timeline-reasoning" data-open={isOpen ? 'true' : undefined}>
      <button
        aria-expanded={isOpen}
        className="timeline-reasoning__toggle"
        onClick={toggle}
        type="button"
      >
        <ThinkingIcon aria-hidden="true" className="timeline-reasoning__mark" />

        <span className="timeline-reasoning__label">{isStreaming ? '正在思考' : '思考完毕'}</span>

        <ChevronDownIcon
          aria-hidden="true"
          className="timeline-reasoning__chevron disclosure__chevron"
        />
      </button>

      <DisclosureBody isOpen={isOpen}>
        <div className="timeline-reasoning__scroll" ref={scrollRef}>
          <div
            className="timeline-prose timeline-reasoning__body"
            data-streaming={isStreaming ? 'true' : undefined}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => {
              const block = blocks[item.index]

              if (block === undefined) {
                return null
              }

              return (
                <div
                  className="timeline-reasoning__block"
                  data-first={item.index === 0 ? 'true' : undefined}
                  data-index={item.index}
                  key={item.key}
                  ref={virtualizer.measureElement}
                  style={{
                    transform: `translateY(${String(snapToDevicePixels(item.start))}px)`,
                  }}
                >
                  <ProseSegment
                    isStreaming={isStreaming && item.index === live}
                    text={block.text}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </DisclosureBody>
    </div>
  )
}
