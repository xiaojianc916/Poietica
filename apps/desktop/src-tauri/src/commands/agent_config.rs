//! Agent 配置：ACP agent 接入档案，以及按 agent 隔离的凭据。
//!
//! 模式 B（受控 home）下，模型与 provider 的真身在各 agent 自己的配置文件里
//! （Kimi Code 是 KIMI_CODE_HOME 下的 config.toml），由 agent 自己 watch 并热
//! 重载。这里存的是 Poietica 侧的接入档案与投影源，不是模型配置的权威副本。
//!
//! 密钥永不落盘。它们写进系统钥匙串，服务名「poietica」，账户名
//! 「agent:{agent_id}:{var_name}」—— 以 agent 与环境变量名共同作为主键，
//! 因为同一个 DeepSeek key 在两个 agent 下是两条独立记录。
//!
//! 旧版本用的账户名是「provider:{id}」。迁移不在这里静默发生：Rust 侧不知道
//! 某个旧 provider 该归到哪个 agent 的哪个变量，那是渲染层才有的知识。旧的
//! provider 列表原样保留在 legacy_providers 里交给界面处置。

use crate::error::{Error, IpcError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, command};
use tauri_plugin_store::StoreExt;

type AgentConfigCommandResult<T> = std::result::Result<T, IpcError>;

const STORE_KEY: &str = "agentConfig";
pub const KEYRING_SERVICE: &str = "poietica";

/// 某个 agent 的某个凭据变量是否已配置。
///
/// 只有布尔值会到达渲染层，明文永远不会。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSecretState {
    pub agent_id: String,
    pub var_name: String,
    pub configured: bool,
}

/// 渲染层工作所依据的完整配置快照。
///
/// agents 是不透明 JSON，由 TS 侧的 @poietica/agent-registry 校验；Rust 侧
/// 只负责存取，不解释任何字段。
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSnapshot {
    pub agents: Vec<Value>,
    pub default_agent_id: String,
    pub secrets: Vec<AgentSecretState>,
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

/// 钥匙串账户名。agent 与变量名共同构成主键。
pub fn keyring_account(agent_id: &str, var_name: &str) -> String {
    format!("agent:{agent_id}:{var_name}")
}

fn legacy_keyring_account(provider_id: &str) -> String {
    format!("provider:{provider_id}")
}

fn has_secret(account: &str) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .map(|entry| entry.get_password().is_ok())
        .unwrap_or(false)
}

/// 读取某个 agent 声明需要的凭据变量名。
///
/// 约定：agent 档案里的 secretVars 是一个字符串数组。缺失或格式不对都按
/// 「这个 agent 不需要凭据」处理 —— 一个写坏的档案不该让整份快照失败。
fn secret_vars_of(agent: &Value) -> Vec<String> {
    agent
        .get("secretVars")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

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

/// 这个 agent 的受控 home 在磁盘上的位置。
///
/// 由 Rust 算，不由渲染层传：渲染层不该发明文件系统路径，而写 provider 的
/// CLI 与起会话的连接必须落在同一个目录，否则配置写进了一个 home、对话读的
/// 是另一个。让两边各自传参数，就是在等它们哪天不一致。
fn controlled_home(app: &AppHandle, agent_id: &str) -> Result<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()?
        .join("agents")
        .join(agent_id)
        .join("home");

    std::fs::create_dir_all(&directory)?;

    Ok(directory)
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

    let found = config
        .agents
        .iter()
        .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id));

    let Some(home_var) = found.and_then(home_var_of) else {
        return Ok(Vec::new());
    };

    let home = controlled_home(app, agent_id)?;

    Ok(vec![(home_var, home.to_string_lossy().into_owned())])
}

fn secret_states(agents: &[Value]) -> Vec<AgentSecretState> {
    let mut states = Vec::new();

    for agent in agents {
        let Some(agent_id) = agent.get("id").and_then(Value::as_str) else {
            continue;
        };

        for var_name in secret_vars_of(agent) {
            let account = keyring_account(agent_id, &var_name);
            states.push(AgentSecretState {
                agent_id: agent_id.to_owned(),
                configured: has_secret(&account),
                var_name,
            });
        }
    }

    states
}

fn read_config(app: &AppHandle) -> Result<(PersistedAgentConfig, Vec<String>)> {
    let store = app.store("agents.json")?;
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
    let secrets = secret_states(&config.agents);

    AgentConfigSnapshot {
        agents: config.agents,
        default_agent_id: config.default_agent_id,
        secrets,
        catalog: config.catalog,
        catalog_fetched_at: config.catalog_fetched_at,
        legacy_providers: config.legacy_providers,
        issues,
    }
}

fn save_config(app: &AppHandle, config: &PersistedAgentConfig) -> Result<()> {
    let store = app.store("agents.json")?;
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

/// 把某个凭据写进系统钥匙串。
///
/// # Errors
///
/// 钥匙串条目无法创建或写入时返回错误。
#[command]
#[specta::specta]
pub async fn agent_config_set_secret(
    app: AppHandle,
    agent_id: String,
    var_name: String,
    value: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let account = keyring_account(&agent_id, &var_name);
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
            .map_err(|error| Error::Internal(error.to_string()))?;
        entry
            .set_password(&value)
            .map_err(|error| Error::Internal(error.to_string()))?;
        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// 从系统钥匙串移除某个凭据。凭据本来就不存在也算成功。
///
/// # Errors
///
/// 仅当 store 无法读取时返回错误。
#[command]
#[specta::specta]
pub async fn agent_config_clear_secret(
    app: AppHandle,
    agent_id: String,
    var_name: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let account = keyring_account(&agent_id, &var_name);
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &account) {
            let _removed = entry.delete_credential();
        }
        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// 把旧账户名 provider:{id} 下的密钥搬到 agent:{id}:{var}。
///
/// 由界面驱动，一条一条搬：只有渲染层知道旧 provider 该归到哪个 agent 的哪个
/// 变量。旧条目搬完即删，避免钥匙串里留下两份同样的密钥。
///
/// 旧条目不存在不是错误 —— 重复调用是安全的。
///
/// # Errors
///
/// 新条目无法写入时返回错误。此时旧条目不会被删除。
#[command]
#[specta::specta]
pub async fn agent_config_migrate_secret(
    app: AppHandle,
    provider_id: String,
    agent_id: String,
    var_name: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let legacy_account = legacy_keyring_account(&provider_id);

        let legacy_value = keyring::Entry::new(KEYRING_SERVICE, &legacy_account)
            .ok()
            .and_then(|entry| entry.get_password().ok());

        if let Some(value) = legacy_value {
            let account = keyring_account(&agent_id, &var_name);
            let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
                .map_err(|error| Error::Internal(error.to_string()))?;
            entry
                .set_password(&value)
                .map_err(|error| Error::Internal(error.to_string()))?;

            if let Ok(legacy) = keyring::Entry::new(KEYRING_SERVICE, &legacy_account) {
                let _removed = legacy.delete_credential();
            }
        }

        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

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
