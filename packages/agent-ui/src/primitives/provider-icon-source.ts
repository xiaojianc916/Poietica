import {
  DeepSeekMark,
  GenericMark,
  MoonshotMark,
  type ProviderMark,
  ZhipuMark,
} from './provider-marks'

/**
 * 厂商名到字形。
 *
 * 此前这里映射的是 new URL(..., import.meta.url).href 产出的资源地址，于是每枚
 * 标记都是一次请求加一次解码。现在映射的是组件：它们随 bundle 到达，答案一到就
 * 能画，中间没有任何一段等待可以被人看见。
 *
 * 匹配仍然是「按名字长度降序，前缀互相包含即算命中」—— agent 报上来的厂商名各
 * 家写法不一（kimi / moonshot / moonshotai 是同一家），这条规则没有变。
 */
export const PROVIDER_MARK_FALLBACK: ProviderMark = GenericMark

/*
 * 一张按名字长度降序排好的表。
 *
 * 此前是一张 Record 加一份从它派生的键数组：先在键里找，再回表里索引一次。
 * 那个 undefined 是这种查法自己造出来的 —— 名字就是从这张表里取的，它不可能
 * 查不到，可 Record<string, T> 在 noUncheckedIndexedAccess 下没法知道这件事。
 * 用断言压住它是在掩盖一个结构问题；把顺序放进表本身，第二次索引就不存在了，
 * 同一张表也不必再由两个数据结构各说一遍。
 *
 * 匹配语义一字未改：按名字长度降序，前缀互相包含即算命中。
 */
const MARKS: ReadonlyArray<readonly [string, ProviderMark]> = Object.entries<ProviderMark>({
  deepseek: DeepSeekMark,
  glm: ZhipuMark,
  kimi: MoonshotMark,
  moonshot: MoonshotMark,
  moonshotai: MoonshotMark,
  zhipu: ZhipuMark,
  zhipuai: ZhipuMark,
}).sort(([left], [right]) => right.length - left.length)

/**
 * 认得出就给它的字形，认不出就给中性的那枚。
 *
 * 注意入参是必填的 string：「还不知道是谁」不走这条路 —— 那是 ProviderIcon 的
 * 未定分支，它画占位而不是画一个确定的错误答案。空字符串仍然落到兜底，因为那是
 * 一个已经拿到、只是没有内容的名字。
 */
export function providerMarkOf(provider: string): ProviderMark {
  const key = provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (key.length === 0) {
    return PROVIDER_MARK_FALLBACK
  }

  const hit = MARKS.find(([name]) => key.startsWith(name) || name.startsWith(key))

  return hit === undefined ? PROVIDER_MARK_FALLBACK : hit[1]
}
