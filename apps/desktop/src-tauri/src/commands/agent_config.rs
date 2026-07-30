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

use crate::error::{Error, IpcError, Result};
use crate::paths::{AGENTS_STORE, agent_home};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager, command};
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

/// 「这个 agent 没有接入档案」只有一句话。
///
/// launch_env 与 agent_program 找的是同一条档案。各写一句，迟早写出两种说法，
/// 而用户看到的是哪一句取决于他先点了什么 —— 那种差异没有任何信息量。
fn profile_missing(agent_id: &str) -> String {
    format!("agents.json 里没有 {agent_id} 的接入档案")
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
/// 档案不存在不再当作「没有变量要设」。
///
/// 那样 homeVar 就不会被设上，agent 会安静地改用用户全局的 ~/.kimi-code，而受控
/// home 是模式 B 的地基：provider 写到哪个 config.toml、CLI 与 ACP 会话看不看得见
/// 同一份配置，全靠它。从安装那天起它一直是这么静默降级的，因为在此之前没有任何
/// 代码路径往 agents.json 里写过东西。
///
/// # Errors
///
/// store 无法打开、档案不存在、或受控 home 无法创建时返回错误。
pub fn launch_env(app: &AppHandle, agent_id: &str) -> Result<Vec<(String, String)>> {
    launch_env_inner(app, agent_id, true)
}

/// 用户全局 home 的启动环境：不设受控 home 变量，其余与 `launch_env` 相同。
///
/// 只为一次性导入的只读探测服务：让 provider list 读到用户全局的配置，而不是
/// 受控 home 里的那一份。写入不走这里 —— 没有什么该写进全局 home 的东西。
///
/// # Errors
///
/// store 无法打开或档案不存在时返回错误。
pub fn global_launch_env(app: &AppHandle, agent_id: &str) -> Result<Vec<(String, String)>> {
    launch_env_inner(app, agent_id, false)
}

fn launch_env_inner(
    app: &AppHandle,
    agent_id: &str,
    controlled_home: bool,
) -> Result<Vec<(String, String)>> {
    let (config, _issues) = read_config(app)?;

    let found = config
        .agents
        .iter()
        .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id))
        .ok_or_else(|| Error::AgentCli(profile_missing(agent_id)))?;

    // 档案声明的变量先进去，受控 home 后进去 —— 后者必须压过前者。用户在 env
    // 里手写的 home 路径可能根本不存在，而 agent_home 交回来的目录是刚刚
    // create_dir_all 出来的。
    let mut env = declared_env_of(found);

    if controlled_home && let Some(home_var) = home_var_of(found) {
        let home = agent_home(app, agent_id)?;
        let _replaced = env.insert(home_var, home.to_string_lossy().into_owned());
    }

    Ok(env.into_iter().collect())
}

/// 这个 agent 的可执行文件。
///
/// 与 `launch_env` 读同一份档案。CLI 用哪个程序、往哪个 home 写 provider，
/// 必须与 ACP 会话起来的那个进程一致；两处各算一次，迟早算出两个。
///
/// 它刻意不来自请求。渲染层报一个程序路径过来，而 `is_allowed` 只校验参数，
/// 于是白名单挡不住 `{ command: 任意程序, args: ["provider", "list"] }`。档案
/// 要先过 TS 侧的 `parseAcpAgentProfile` 才写得进 agents.json，绕过这里的成本
/// 因此高得多 —— 但也仅此而已，所以调用方仍要自己校验一遍程序名。
///
/// # Errors
///
/// store 无法打开、档案不存在、或档案里没有可用的 command 时返回错误。
pub fn agent_program(app: &AppHandle, agent_id: &str) -> Result<String> {
    let (config, _issues) = read_config(app)?;

    let found = config
        .agents
        .iter()
        .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id))
        .ok_or_else(|| Error::AgentCli(profile_missing(agent_id)))?;

    let program = found
        .get("command")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| Error::AgentCli(format!("{agent_id} 的接入档案里没有可执行文件")))?;

    Ok(program.to_owned())
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

/// 从一份 config.toml 的文本里提取每个 provider 的密钥尾号。
///
/// 刻意逐行扫描而不是解析 TOML：为五个字符引入一个 TOML 解析器不值当。扫描规则
/// 刻意严格 —— [providers.<id>] 段内的 api_key = "..."，双引号必需、只认 ASCII 空白，
/// 不认就跳过而不是猜。界面的行不来自这份表（产地是 provider list），读不到时
/// 那一行只显示 id，不编。
fn tails_from_config(text: &str) -> BTreeMap<String, String> {
    let mut tails: BTreeMap<String, String> = BTreeMap::new();
    let mut current: Option<String> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim();

        if line.starts_with('[') {
            current = line
                .strip_prefix("[providers.")
                .and_then(|rest| rest.strip_suffix(']'))
                .map(str::to_owned);

            continue;
        }

        let Some(provider_id) = current.as_deref() else {
            continue;
        };

        let Some(value) = line.strip_prefix("api_key") else {
            continue;
        };

        let quoted = value.trim_start_matches([' ', '=']);

        let Some(inner) = quoted
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
        else {
            continue;
        };

        if inner.is_empty() {
            continue;
        }

        let tail: String = inner
            .chars()
            .rev()
            .take(5)
            .collect::<Vec<char>>()
            .into_iter()
            .rev()
            .collect();

        let _previous = tails.insert(provider_id.to_owned(), tail);
    }

    tails
}

/// 每个已配置 provider 的密钥尾号：provider id → 密钥最后 5 个字符。
///
/// 尾号的事实就在 agent 自己的 config.toml 里，与「写经谁手」无关 —— 所以是读时
/// 现算，而不是写时备忘（上一版的备忘方案对官方 CLI 配置的密钥永远失效）。只读、
/// 尽力而为：受控 home 的文件不在就退回用户全局 home（官方 CLI 写的那一份），
/// 都不在就是空表。密钥本体不离开这个函数。
///
/// # Errors
///
/// 此命令不返回错误；任何一步失败都退成空表或更少的条目。
#[command]
#[specta::specta]
pub async fn agent_key_tails(app: AppHandle, agent_id: String) -> BTreeMap<String, String> {
    let home = agent_home(&app, &agent_id).ok();

    if let Some(home) = home
        && let Ok(text) = std::fs::read_to_string(home.join("config.toml"))
    {
        return tails_from_config(&text);
    }

    let Some(config_dir) = app.path().home_dir().ok().map(|dir| dir.join(".kimi-code")) else {
        return BTreeMap::new();
    };

    std::fs::read_to_string(config_dir.join("config.toml"))
        .map(|text| tails_from_config(&text))
        .unwrap_or_default()
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

/*
 * agent_config_save_catalog 曾在这里。
 *
 * 它把 models.dev 的响应体缓存进 agents.json。缓存的是我们自己拉的那一份，而
 * agent 内部也拉同一份、并且只认自己那份 —— 候选模型改问它的
 * provider catalog list，这里就没有第二份目录需要存了。
 */

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
