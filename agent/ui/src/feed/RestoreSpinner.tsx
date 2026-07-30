import './restore-spinner.css'

export interface RestoreSpinnerProps {
  /** 这一格正在把一条对话读出来，而且还没有任何一行可画。 */
  readonly active: boolean
}

/**
 * 空白正中的那一个小图标。
 *
 * 回放一条已有对话时，界面按最终形态预排版（data-started），而转录还是空的：
 * 开场白被塌掉，转录高度为零，于是滚动区里一个像素都没有。那段空白是刻意
 * 换来的——它买到的是"回放到达时没有状态翻转"——但它此前不带任何反馈。
 * 这个图标就是补上的那一句反馈，没有别的职责。
 *
 * 只有图标和它自己的动画：没有文案，没有底板，没有遮罩，没有骨架屏。骨架屏
 * 在这里是错的——回放出来的行高矮不一，假条会在真内容到达时换一次形。
 *
 * 它是浮层，不占文档流。外面已经按"必然有内容"排好了版，图标一旦参与布局，
 * 撤除时就会把内容顶一下，那正是 data-started 花力气避开的东西。
 *
 * 名字挂在 svg 上，不挂在外面那层。外层是 live region，负责"这里出现了新
 * 状态"；名字属于那个图形本身，而且这也是 Biome 的 noSvgWithoutTitle 承认的
 * 两种写法之一（另一种是把 <title> 作为第一个子节点）。一个名字，一次播报。
 */
export function RestoreSpinner({ active }: RestoreSpinnerProps) {
  if (!active) {
    return null
  }

  return (
    <div className="restore-spinner" role="status">
      <svg
        aria-label="正在载入对话"
        className="restore-spinner__mark"
        focusable="false"
        role="img"
        viewBox="0 0 24 24"
      >
        <circle className="restore-spinner__track" cx="12" cy="12" r="9" />
        <circle className="restore-spinner__head" cx="12" cy="12" r="9" />
      </svg>
    </div>
  )
}
