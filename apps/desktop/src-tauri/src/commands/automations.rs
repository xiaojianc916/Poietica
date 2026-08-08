use crate::error::{IpcError, Result};
use crate::paths::automations_store;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, PoisonError};
use tauri::{AppHandle, Wry, command};
use tauri_plugin_store::{Store, StoreExt};

type AutomationsCommandResult<T> = std::result::Result<T, IpcError>;

/// 账本只留最近这么多次。再往前的正文仍在各自那条对话里。
///
/// 常量在这一侧而不在渲染进程：账本归这里所有，裁剪是它自己的不变量。放在
/// 调用方那侧，任何一条没走那段代码的写入都会让账本无限长下去。
const RUN_HISTORY_LIMIT: usize = 50;

/*
 * 目录文件的写入串行化。
 *
 * 每一条写命令都是「读—改—写」，而 tauri 的命令处理器彼此并发。两条命令交错，
 * 后写的那条就会把先写的那条整段盖掉。这把锁只保护这个模块自己拥有的那一个
 * 文件，不是给别人摸的全局状态。
 *
 * 用 std 的互斥锁而不是异步锁：临界区里没有 .await，纯文件读写，跨不了让点，
 * 因此这些 future 仍然是 Send，也不必为一次毫秒级的写引入一整套异步锁语义。
 */
static LEDGER: Mutex<()> = Mutex::new(());

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
    Interval {
        every_minutes: u32,
    },
    #[serde(rename_all = "camelCase")]
    Daily {
        at_minute_of_day: u32,
    },
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
    /// 这次运行要改掉的会话设置，按 agent 报的 controlId 记。
    ///
    /// 值是 agent 自己的词汇（模型别名、推理档位、模式），这一层不认识也不
    /// 校验：候选由它在 session/new 里报出，随时可能改名或撤回。空表就是
    /// 「跟随全局默认」，所以缺席与空表是同一个意思，serde(default) 足够。
    ///
    /// BTreeMap 而非 HashMap：写进 JSON 的键序要稳定，否则每次保存都是一次
    /// 无意义的磁盘差异。生成的 TypeScript 因此是 Partial<Record<..>>。
    #[serde(default)]
    pub session_config: BTreeMap<String, String>,
    /// 运行账本。归这一侧所有 —— 见 automations_upsert。
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

/// 一次运行跑完之后，日程该怎么走。
///
/// 由发起那次运行的一侧算出来、随记账一起提交；这一侧只做比对，不重算。手动
/// 试运行落在 Keep 上：cron、systemd timer 与 Kubernetes CronJob 的手动触发
/// 都不改写周期计划，这里同一条规矩。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationReschedule {
    Keep,
    #[serde(rename_all = "camelCase")]
    Advance {
        /// 刚刚到期的那个时刻。与盘上的 next_run_at 对不上就说明日程已经被人
        /// 动过，这次推进作废 —— 比较并交换，不是无条件覆盖。
        from: String,
        to: Option<String>,
    },
}

/// 一次运行的提交：记一笔账，并按上面的判定推进日程。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunRecord {
    pub id: String,
    pub run: AutomationRun,
    pub reschedule: AutomationReschedule,
}

fn open(app: &AppHandle) -> Result<Arc<Store<Wry>>> {
    Ok(app.store(automations_store(app)?)?)
}

/// 读出目录。读不懂的原件先挪走，再如实报错。
fn read_catalog(store: &Store<Wry>) -> Result<AutomationCatalog> {
    let Some(value) = store.get("automations") else {
        return Ok(AutomationCatalog::default());
    };

    match serde_json::from_value::<AutomationCatalog>(value.clone()) {
        Ok(catalog) => Ok(catalog),
        Err(cause) => {
            /*
             * 读不懂的目录不丢：原件挪到备份键、主键删除，然后如实报错。
             * 下一次启动读到的是「没有」，而不是又一次解析失败；原件留底，
             * 不会被下一次保存盖掉。VS Code 的 state 备份与 Chrome 的
             * Preferences.bad 是同一个做法。
             */
            store.set("automations.corrupt", value);
            store.delete("automations");
            store.save()?;

            Err(cause.into())
        }
    }
}

/// 读—改—写，全程持锁，回给写完之后的整本目录。
///
/// 每一条写命令都长这个样子，于是「怎么写盘」在这个模块里只有一份实现。
fn mutate(app: &AppHandle, edit: impl FnOnce(&mut Vec<Automation>)) -> Result<AutomationCatalog> {
    let _guard = LEDGER.lock().unwrap_or_else(PoisonError::into_inner);

    let store = open(app)?;
    let mut catalog = read_catalog(&store)?;

    edit(&mut catalog.automations);

    store.set("automations", serde_json::to_value(&catalog)?);
    store.save()?;

    Ok(catalog)
}

/// Reads the persisted automations.
///
/// # Errors
///
/// Returns an error when the store cannot be opened, or when the stored
/// catalog cannot be parsed. In that case the unreadable original is first
/// moved to the automations.corrupt backup key: falling back to an empty
/// catalog without keeping the original would let the next write overwrite
/// the only copy of the user's automations.
#[command]
#[specta::specta]
pub async fn automations_load(app: AppHandle) -> AutomationsCommandResult<AutomationCatalog> {
    (|| -> Result<AutomationCatalog> {
        let store = open(&app)?;

        read_catalog(&store)
    })()
    .map_err(IpcError::from)
}

/// Creates or replaces one automation and returns the catalog as written.
///
/// The run ledger is not taken from the caller: it belongs to this side, so the
/// stored runs are kept and the incoming ones ignored. A caller that forgot to
/// send them would otherwise erase the history.
///
/// # Errors
///
/// Returns an error when the store cannot be opened, when the catalog cannot be
/// serialized, or when the write does not reach disk.
#[command]
#[specta::specta]
pub async fn automations_upsert(
    app: AppHandle,
    automation: Automation,
) -> AutomationsCommandResult<AutomationCatalog> {
    mutate(&app, move |automations| {
        let at = automations
            .iter()
            .position(|candidate| candidate.id == automation.id);
        let kept = at
            .and_then(|index| automations.get(index))
            .map_or_else(Vec::new, |existing| existing.runs.clone());
        let saved = Automation {
            runs: kept,
            ..automation
        };

        match at {
            Some(index) => {
                automations.remove(index);
                automations.insert(index, saved);
            }
            None => automations.insert(0, saved),
        }
    })
    .map_err(IpcError::from)
}

/// Removes one automation and returns the catalog as written.
///
/// Removing something that is already gone is a success, not an error: the
/// caller asked for a state and that state already holds. HTTP DELETE is
/// specified the same way.
///
/// # Errors
///
/// Returns an error when the store cannot be opened, when the catalog cannot be
/// serialized, or when the write does not reach disk.
#[command]
#[specta::specta]
pub async fn automations_remove(
    app: AppHandle,
    id: String,
) -> AutomationsCommandResult<AutomationCatalog> {
    mutate(&app, move |automations| {
        automations.retain(|candidate| candidate.id != id);
    })
    .map_err(IpcError::from)
}

/// Records one run and advances the schedule, returning the catalog as written.
///
/// # Errors
///
/// Returns an error when the store cannot be opened, when the catalog cannot be
/// serialized, or when the write does not reach disk.
#[command]
#[specta::specta]
pub async fn automations_record_run(
    app: AppHandle,
    record: AutomationRunRecord,
) -> AutomationsCommandResult<AutomationCatalog> {
    let AutomationRunRecord {
        id,
        run,
        reschedule,
    } = record;

    mutate(&app, move |automations| {
        let Some(existing) = automations.iter_mut().find(|candidate| candidate.id == id) else {
            /* 跑的过程中被删掉了。这是一个合法的时序，不是错误。 */
            return;
        };

        existing.runs.insert(0, run);
        existing.runs.truncate(RUN_HISTORY_LIMIT);

        /*
         * 比较并交换：只有盘上那个「下一次到期」仍然是刚刚到期的那个，才把它
         * 推到下一格。运行期间有人改过触发条件、停用过、或者另一次运行已经推
         * 过了，from 都对不上，这次推进作废。停用的那条 next_run_at 是 None，
         * 同样对不上 —— 不必再单独判一次 enabled。
         */
        if let AutomationReschedule::Advance { from, to } = reschedule
            && existing.next_run_at.as_deref() == Some(from.as_str())
        {
            existing.next_run_at = to;
        }
    })
    .map_err(IpcError::from)
}
