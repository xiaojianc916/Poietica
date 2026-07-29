//! Agent 配置：ACP agent 接入档案，以及按 agent 隔离的凭据。
//!
//! 模式 B（受控 home）下，模型与 provider 的真身在各 agent 自己的配置文件里
//! （Kimi Code 是 `KIMI_CODE_HOME` 下的 config.toml），由 agent 自己 watch 并热
//! 重载。这里存的是 Poietica 侧的接入档案与投影源，不是模型配置的权威副本。
//!
//! 这里不存密钥，一份都不存。
//!
//! API key 的整个生命是一次投递：界面拿到用户输入，经 `agent_cli_exec` 注入子
//! 进程的环境变量，agent 官方 CLI 在那一瞬读走，写进它自己 config.toml 的
//! `[providers.<id>].api_key` —— 明文。此后 agent 只读那个文件。
//!
//! 所以钥匙串在这条链上保护不了任何东西：下游是一个明文文件，能读它的人不需要
//! 撬钥匙串。曾经存过一份，账户名是「agent:{id}:{var}」，那份副本换来的只有
//! 「不用重新输一次 key」，代价是写入、清除、跨代迁移三条命令和两代账户名。
//!
//! 上游自己的范式也是一次性的：`KIMI_REGISTRY_API_KEY=...` kimi provider add ...
//! 「哪些 provider 已配好」的权威因此是 agent，问它的 provider list，不是问
//! 我们。旧的 provider 列表仍原样保留在 `legacy_providers` 里交给界面处置。

use crate::error::{IpcError, Result};
use crate::paths::{AGENTS_STORE, agent_home};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::collections::BTreeMap;
use tauri::{AppHandle, command};
use tauri_plugin_store::StoreExt;

type AgentConfigCommandResult<T> = std::result::Result<T, IpcError>;

const STORE_KEY: &str = "agentConfig";

/// 渲染层工作所依据的完整配置快照。
///
/// agents 是不透明 JSON，由 TS 侧的 @poietica/agent-registry 校验；Rust 侧
/// 只负责存取，不解释任何字段。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSnapshot {
    pub agents: Vec<Value>,
    pub default_agent_id: String,
    /// models.dev 目录缓存。Null 表示还没成功拉取过。
    pub catalog: Value,
    /// 目录缓存的拉取时间（ISO-8601）。空串表示从未拉取。
    pub catalog_fetched_at: String,
    /// 旧版顶层 provider 列表，仅用于一次性迁移。迁移完由界面清空。
    pub legacy_providers: Vec<Value>,
    /// agents.json 中存在但无法反序列化的内容。界面应显示出来。
    pub issues: Vec<String>,
}

/// 落盘到 agents.json 的形状。
#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct PersistedAgentConfig {
    agents: Vec<Value>,
    default_agent_id: String,
    catalog: Value,
    catalog_fetched_at: String,
    /// 旧字段。serde 默认会丢弃未知字段，若不显式接住，用户既有的 provider
    /// 配置会在第一次保存时无声蒸发。
    #[serde(rename = "providers")]
    legacy_providers: Vec<Value>,
}

/*
 * 这里曾有 keyring_account、legacy_keyring_account、has_secret 与
 * secret_vars_of。它们随「不存密钥」一起删了。
 *
 * 顺带记一笔 secret_vars_of 的下场：它读的是档案里的 secretVars，而
 * AcpAgentProfile 从来没有过这个字段，于是它恒返回空，secret_states 恒返回空，
 * snapshot.secrets 从第一天起就是空数组。没有人看得出来，因为也没有人读它。
 */

/// 读取某个 agent 声明的 home 环境变量名。
///
/// 约定同 secretVars：档案里的 homeVar 是一个字符串。缺失表示这个 agent 不
/// 接受受控 home，启动时就不设这个变量。
fn home_var_of(agent: &Value) -> Option<String> {
    agent
        .get("homeVar")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// 档案里声明的非密文启动变量。
///
/// 约定同 secretVars：档案里的 env 是一张字符串表。值不是字符串的条目被丢弃
/// 而不是让整次启动失败 —— 一个写坏的档案不该让 agent 起不来。
fn declared_env_of(agent: &Value) -> BTreeMap<String, String> {
    agent
        .get("env")
        .and_then(Value::as_object)
        .map(|table| {
            table
                .iter()
                .filter_map(|(name, value)| {
                    value.as_str().map(|text| (name.clone(), text.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 启动这个 agent 的子进程时要设的环境变量。
///
/// 只有非密文的启动变量。密钥不在这里：模式 B 下它们由 agent 自己的 CLI 写
/// 进受控 home 里的配置文件，从不经过 ACP 的启动环境。
///
/// # Errors
///
/// store 无法打开、或受控 home 无法创建时返回错误。
pub fn launch_env(app: &AppHandle, agent_id: &str) -> Result<Vec<(String, String)>> {
    let (config, _issues) = read_config(app)?;

    let Some(found) = config
        .agents
        .iter()
        .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id))
    else {
        return Ok(Vec::new());
    };

    // 档案声明的变量先进去，受控 home 后进去 —— 后者必须压过前者。用户在 env
    // 里手写的 home 路径可能根本不存在，而 agent_home 交回来的目录是刚刚
    // create_dir_all 出来的。
    let mut env = declared_env_of(found);

    if let Some(home_var) = home_var_of(found) {
        let home = agent_home(app, agent_id)?;
        let _replaced = env.insert(home_var, home.to_string_lossy().into_owned());
    }

    Ok(env.into_iter().collect())
}

/*
 * secret_states 也一并删了：快照不再有 secrets 字段。
 */

fn read_config(app: &AppHandle) -> Result<(PersistedAgentConfig, Vec<String>)> {
    let store = app.store(AGENTS_STORE)?;
    let mut issues = Vec::new();

    let config = match store.get(STORE_KEY) {
        None => PersistedAgentConfig::default(),
        Some(value) => match serde_json::from_value(value) {
            Ok(parsed) => parsed,
            Err(error) => {
                issues.push(format!("agents.json 格式无效：{error}"));
                PersistedAgentConfig::default()
            }
        },
    };

    Ok((config, issues))
}

fn to_snapshot(config: PersistedAgentConfig, issues: Vec<String>) -> AgentConfigSnapshot {
    AgentConfigSnapshot {
        agents: config.agents,
        default_agent_id: config.default_agent_id,
        catalog: config.catalog,
        catalog_fetched_at: config.catalog_fetched_at,
        legacy_providers: config.legacy_providers,
        issues,
    }
}

fn save_config(app: &AppHandle, config: &PersistedAgentConfig) -> Result<()> {
    let store = app.store(AGENTS_STORE)?;
    store.set(STORE_KEY, serde_json::to_value(config)?);
    store.save()?;
    Ok(())
}

/// 读取完整配置快照。
///
/// agents.json 缺失或损坏都不算失败：返回空配置，把解析问题放进 issues。
///
/// # Errors
///
/// 仅当 store 插件无法打开时返回错误。
#[command]
#[specta::specta]
pub async fn agent_config_get(app: AppHandle) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// 替换 agent 列表与默认 agent。
///
/// # Errors
///
/// store 无法写入时返回错误。
#[command]
#[specta::specta]
pub async fn agent_config_save_agents(
    app: AppHandle,
    agents: Vec<Value>,
    default_agent_id: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let (mut config, issues) = read_config(&app)?;
        config.agents = agents;
        config.default_agent_id = default_agent_id;
        save_config(&app, &config)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// 写入 models.dev 目录缓存。
///
/// 目录本身不是敏感数据，随 agents.json 落盘。它只是「离线也能看见模型清单」
/// 的副本，权威始终是联网拉取的结果。
///
/// # Errors
///
/// store 无法写入时返回错误。
#[command]
#[specta::specta]
pub async fn agent_config_save_catalog(
    app: AppHandle,
    catalog: Value,
    fetched_at: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let (mut config, issues) = read_config(&app)?;
        config.catalog = catalog;
        config.catalog_fetched_at = fetched_at;
        save_config(&app, &config)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/*
 * agent_config_set_secret、agent_config_clear_secret 与
 * agent_config_migrate_secret 曾在这里。
 *
 * 三条命令都在维护一份我们保护不了的副本。migrate_secret 更是把旧账户名搬到新
 * 账户名 —— 一次为了兼容自己上一版而存在的迁移。不存密钥，两样都不需要。
 */

/// 清空旧的顶层 provider 列表。界面确认迁移完成后调用一次。
///
/// # Errors
///
/// store 无法写入时返回错误。
#[command]
#[specta::specta]
pub async fn agent_config_clear_legacy_providers(
    app: AppHandle,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let (mut config, issues) = read_config(&app)?;
        config.legacy_providers = Vec::new();
        save_config(&app, &config)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}
