use crate::error::{IpcError, Result};
use crate::paths::AUTOMATIONS_STORE;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, command};
use tauri_plugin_store::StoreExt;

type AutomationsCommandResult<T> = std::result::Result<T, IpcError>;

/// 触发条件。
///
/// 判别联合，不是一段 cron 字符串。本地桌面只需要「每 N 分钟」与「每天几点」
/// 两种，而一个 cron 解析器是这两件事之外多出来的一整门语言，还带来一整类
/// 非法输入。GitHub Actions 用 cron 是因为它要表达跨时区任意周期；这里不需要。
///
/// 写成 Rust 枚举，生成的 TypeScript 就是一个判别联合，界面不必在每个分支上
/// 各自断言一次。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationTrigger {
    Manual,
    #[serde(rename_all = "camelCase")]
    Interval { every_minutes: u32 },
    #[serde(rename_all = "camelCase")]
    Daily { at_minute_of_day: u32 },
}

#[derive(Debug, Deserialize, Serialize, Type, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AutomationRunOutcome {
    Succeeded,
    Failed,
}

/// 一次运行的账目。
///
/// 只有指针和结局，没有正文：一次运行就是一条对话，说过什么由那条对话自己
/// 保管。这里再存一份，就是 AGENTS.md 明令禁止的第二份运行状态。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    /// 这次运行开出来的那条对话。开不出来时为 None。
    pub thread_id: Option<String>,
    /// RFC 3339。全库其余每一处时间戳都是这个格式。
    pub started_at: String,
    pub outcome: AutomationRunOutcome,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub title: String,
    /// 到期时发给 agent 的那句话。自动化的全部行为都由它决定。
    pub prompt: String,
    pub trigger: AutomationTrigger,
    pub enabled: bool,
    pub created_at: String,
    /// 下一次到期的时刻，RFC 3339；manual 为 None。
    ///
    /// 它是被存下来的状态，不是每次由 last_run 推出来的推论：只有存下来，
    /// 关机三天之后再打开才分得清「这次错过了」与「刚刚才排上」。cron 守护
    /// 进程与 Temporal 这类调度器的做法都是如此。
    pub next_run_at: Option<String>,
    pub runs: Vec<AutomationRun>,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AutomationCatalog {
    pub version: u32,
    pub automations: Vec<Automation>,
}

impl Default for AutomationCatalog {
    fn default() -> Self {
        Self {
            version: 1,
            automations: Vec::new(),
        }
    }
}

/// Reads the persisted automations.
///
/// # Errors
///
/// Returns an error when the store cannot be opened. A store that opens but
/// holds a value of an older shape is not an error: it falls back to an empty
/// catalog so the surface stays usable. 与 settings_get 同一条判断。
#[command]
#[specta::specta]
pub async fn automations_load(app: AppHandle) -> AutomationsCommandResult<AutomationCatalog> {
    (|| -> Result<AutomationCatalog> {
        let store = app.store(AUTOMATIONS_STORE)?;

        Ok(store
            .get("automations")
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
    })()
    .map_err(IpcError::from)
}

/// Persists the automations.
///
/// # Errors
///
/// Returns an error when the store cannot be opened, when the catalog cannot be
/// serialized, or when the write does not reach disk.
#[command]
#[specta::specta]
pub async fn automations_save(
    app: AppHandle,
    catalog: AutomationCatalog,
) -> AutomationsCommandResult<()> {
    (|| -> Result<()> {
        let store = app.store(AUTOMATIONS_STORE)?;
        store.set("automations", serde_json::to_value(&catalog)?);
        store.save()?;
        Ok(())
    })()
    .map_err(IpcError::from)
}
