# Dependency cleanup report

生成时间：2026-07-22T07:20:44.684Z

执行模式：apply

本报告只分析直接依赖和显式源码引用，不根据依赖名称推断传递依赖是否可删除。

## Desktop npm 直接依赖

| 依赖 | 引用位置 | 结论 |
|---|---|---|
| `@poietica/file` | 未发现 | 删除候选 |
| `@poietica/flowchart` | `apps/desktop/src/bootstrap/application.ts` | 保留 |
| `@poietica/foundations-observability` | `apps/desktop/src/bootstrap/ApplicationErrorBoundary.tsx`<br>`apps/desktop/src/bootstrap/application-lifecycle.ts`<br>`apps/desktop/src/presentation/boundaries/UiErrorBoundary.tsx`<br>`apps/desktop/src/presentation/ui/ui-feedback.tsx` | 保留 |
| `@tauri-apps/api` | 未发现 | 删除候选 |
| `lucide-react` | `apps/desktop/src/bootstrap/ApplicationErrorBoundary.tsx`<br>`apps/desktop/src/presentation/chrome/DesktopTitleBar.tsx`<br>`apps/desktop/src/presentation/ui/ui-feedback.tsx` | 保留 |
| `tldraw` | `apps/desktop/src/app.css` | 保留 |

## Tauri Rust 直接依赖

| 依赖 | Rust 引用位置 | 结论 |
|---|---|---|
| `tauri-plugin-os` | 未发现 | 删除候选 |
| `tauri-plugin-updater` | `apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-process` | `apps/desktop/src-tauri/src/bootstrap/app.rs` | 保留 |
| `tauri-plugin-shell` | `apps/desktop/src-tauri/src/bootstrap/app.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-notification` | `apps/desktop/src-tauri/src/bootstrap/app.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-global-shortcut` | `apps/desktop/src-tauri/src/bootstrap/app.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-window-state` | `apps/desktop/src-tauri/src/commands/window.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-clipboard-manager` | `apps/desktop/src-tauri/src/bootstrap/app.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-fs` | `apps/desktop/src-tauri/src/bootstrap/app.rs`<br>`apps/desktop/src-tauri/src/commands/file.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |
| `tauri-plugin-opener` | `apps/desktop/src-tauri/src/bootstrap/app.rs`<br>`apps/desktop/src-tauri/src/error.rs` | 保留 |

## Tauri 插件注册一致性

| 插件 | Cargo 声明 | bootstrap 引用 | 结论 |
|---|---:|---:|---|
| `tauri-plugin-store` | 是 | 是 | 一致 |
| `tauri-plugin-dialog` | 是 | 是 | 一致 |
| `tauri-plugin-fs` | 是 | 是 | 一致 |
| `tauri-plugin-opener` | 是 | 是 | 一致 |
| `tauri-plugin-clipboard-manager` | 是 | 是 | 一致 |
| `tauri-plugin-shell` | 是 | 是 | 一致 |
| `tauri-plugin-process` | 是 | 是 | 一致 |
| `tauri-plugin-global-shortcut` | 是 | 是 | 一致 |
| `tauri-plugin-notification` | 是 | 是 | 一致 |
| `tauri-plugin-window-state` | 是 | 否 | 未在 bootstrap 引用；确认是否由其他命令直接使用 |
| `tauri-plugin-updater` | 是 | 否 | 未在 bootstrap 引用；确认是否由其他命令直接使用 |
| `tauri-plugin-os` | 否 | 否 | 未使用 |
| `tauri-plugin-log` | 是 | 否 | 未在 bootstrap 引用；确认是否由其他命令直接使用 |

## Settings IPC 契约

| Rust 字段 | TypeScript 预期字段 | Rust 存在 | TS 出现位置 |
|---|---|---:|---|
| `theme` | `theme` | 是 | `features/settings/src/domain/settings.ts`<br>`features/settings/src/presentation/SettingsDialog.tsx` |
| `language` | `language` | 是 | `features/settings/src/domain/settings.ts`<br>`features/settings/src/presentation/SettingsDialog.tsx` |
| `auto_save` | `autoSave` | 是 | `features/settings/src/domain/settings.ts`<br>`features/settings/src/presentation/SettingsDialog.tsx` |
| `auto_save_interval` | `autoSaveInterval` | 是 | 未发现 |
| `shortcuts` | `shortcuts` | 是 | `features/settings/src/domain/settings.ts` |
| `canvas` | `canvas` | 是 | `features/settings/src/domain/settings.ts`<br>`features/settings/src/presentation/SettingsDialog.tsx` |
| `editor` | `editor` | 是 | `features/settings/src/domain/settings.ts` |
| `export` | `export` | 是 | `features/settings/src/domain/settings.ts`<br>`features/settings/src/ports/settings-store.ts`<br>`features/settings/src/presentation/SettingsDialog.tsx`<br>`features/settings/src/presentation/public-api.ts`<br>`features/settings/src/public-api.ts` |
| `privacy` | `privacy` | 是 | `features/settings/src/domain/settings.ts` |

> 此检查只能发现明显字段漂移。最终传输契约仍应以 Specta 生成文件为唯一来源。

