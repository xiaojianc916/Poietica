/// <reference types="vite/client" />

/*
 * 只声明本项目自己的环境变量：资源模块（*.svg 等）与 ImportMeta.env 的
 * 基础形状由 vite/client 提供，重复手写只会与官方声明产生漂移。
 */
interface ImportMetaEnv {
  readonly VITE_TLDRAW_LICENSE_KEY?: string
}
