/*
 * 包的唯一入口。逐个具名导出，不用 export *：这样「对外承诺了什么」是这一份
 * 文件读得出来的事实，而不是一次通配符展开的副作用。
 */

export {
  type AutomationDraft,
  type AutomationSummary,
  DEFAULT_SCHEDULE,
  describeMoment,
  describeSchedule,
  latestRun,
  nextRunAfter,
  SCHEDULE_PRESETS,
  type ScheduleProblem,
  scheduleProblem,
  sessionConfigOf,
  summarize,
} from './automation'
export {
  type AutomationDispatch,
  type AutomationStore,
  type AutomationsViewModel,
  createAutomationStore,
} from './automation-store'
export { AutomationsSurface, type AutomationsSurfaceProps } from './surface/automations-surface'
export {
  AUTOMATION_CATEGORIES,
  AUTOMATION_TEMPLATES,
  type AutomationCategory,
  type AutomationTemplate,
} from './templates'
