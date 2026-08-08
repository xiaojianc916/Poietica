import type { RunEvent } from '../run'

/*
 * 录像里的 frame 就是原生侧写下的那一份 wire 值。它的形状由 RunFrame 在编译期定
 * 下，读它的测试断言的是投影结果，不是形状，所以不需要再过一遍校验器。
 *
 * 这句话此前在三个测试文件里各写了一遍，其中两份还各抄了一份一模一样的注释。它是
 * 契约层的话，不是某个消费者的话 —— 所以它住在契约包里，只有一份。
 */
export const asRunEvents = (
  recording: readonly { readonly frame: unknown }[],
): readonly RunEvent[] => recording.map((captured) => captured.frame as RunEvent)
