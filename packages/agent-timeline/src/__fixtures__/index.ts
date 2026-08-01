/*
 * 录制样本的对外入口。
 *
 * 样本是测试资产，不是产品 API。此前 SAMPLE_RUN_EVENTS 挂在包的主入口上：任何
 * 引用这个包的产品代码都能顺手 import 到一份 fixture，打包器也没有理由把它摇
 * 掉。挪到独立子路径后，主入口只剩契约、reducer 与 selector。
 *
 * 包内有两份 recordedTurn（工具轮次与授权轮次），所以边界上按录的是什么起名，
 * 而不是把包内的裸名字原样漏出去。
 */

export { SAMPLE_RUN_EVENTS } from './timeline-fixtures'
export { recordedTurn as recordedToolTurn } from './tool-turn.generated'
