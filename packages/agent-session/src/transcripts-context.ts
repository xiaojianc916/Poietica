import { createContext, useContext } from 'react'
import type { TranscriptStore } from './transcript-store'

/*
 * 转录 store 由谁给。
 *
 * 它此前是 transcript-store.ts 末尾的一行 export const transcripts = new
 * TranscriptStore()，而同一个文件的开头用二十行论证「模块级可变状态没法在测试里
 * 拿到干净实例：模块随 import 求值一次，用例之间互相留痕」。那段论证是对的，只是
 * 没走到底 —— 字段收进了类，实例本身仍然是模块级可变状态，那道「一个 store 订着
 * 一条线路」的守卫因此仍然是进程级的。
 *
 * 这是 React 对「外部 store 接进组件树」给出的形状：实例由组合根造出来，经 Context
 * 交给下面所有人，useSyncExternalStore 订的是拿到手的那一个，不是 import 来的那一
 * 个。同一层的对话列表是同一个形制（threads-context.ts）：导出 context 本体与读它
 * 的 hook，provider 就是 context —— React 19 起 <Context value> 是官方形制，旧的那个
 * 内层属性会被废弃。此前这里额外导出了一个指向它的别名，那不只是多一种写法：使用处
 * 写的是那个别名，全仓按旧形制搜根本搜不到它，一次半迁移就这样藏了下来。
 *
 * 没有默认实例：拿不到就是接线漏了，那要当场说出来，而不是让半棵组件树安静地对着
 * 另一份永远不会更新的空转录。
 */
export const TranscriptsContext = createContext<TranscriptStore | null>(null)

export function useTranscripts(): TranscriptStore {
  const store = useContext(TranscriptsContext)

  if (store === null) {
    throw new Error('这棵组件树上没有 TranscriptsContext，转录无处可读。')
  }

  return store
}
