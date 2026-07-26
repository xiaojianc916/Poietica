/**
 * 普通 .css 只做副作用导入：空模块声明让 `import './x.css'` 通过类型检查，
 * 同时从类型层面禁止 default 导入 —— 类名映射只存在于 *.module.css。
 *
 * 这里不引用 vite/client，因为 @poietica/features-settings 不依赖 vite。
 */
declare module '*.css' {}
