/*
 * 包的 contracts 入口。
 *
 * 这里不抄第二份符号清单：公共面由 contracts/public-api.ts 一处说了算。
 * 此前两份手写白名单逐字重复，一个符号要活着必须在两处各登记一次，而漏
 * 登记的那次不是类型错误，是运行期 SyntaxError。
 */
export * from './contracts/public-api'
