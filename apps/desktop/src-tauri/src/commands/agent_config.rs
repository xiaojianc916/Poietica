//! Agent configuration: model provider profiles, ACP agent profiles, and
//! provider secrets in the system keychain.
//!
//! Provider profiles and agent profiles live in `agents.json`, written
//! atomically by the store plugin (same pattern as `settings.json`).
//!
//! Secrets never touch disk. They are written to and read from the system
//! keychain under the service name `"poietica"`, with the account name
//! `"provider:{id}"`. The snapshot handed back to the renderer carries only
//! a boolean per provider: configured or not.

use crate::error::{Error, IpcError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, command};
use tauri_plugin_store::StoreExt;

type AgentConfigCommandResult<T> = std::result::Result<T, IpcError>;

const STORE_KEY: &str = "agentConfig";
const KEYRING_SERVICE: &str = "poietica";

/// Whether a provider's API key is stored in the system keychain.
///
/// The secret value is never handed to the renderer; only the boolean
/// reaches it. The renderer uses this to decide whether to show a
/// "configured" badge or an empty key field.
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretState {
    pub provider_id: String,
    pub configured: bool,
}

/// The full configuration snapshot the renderer works from.
///
/// `providers` and `agents` are opaque JSON values validated on the
/// TypeScript side by `@poietica/agent-registry`. The Rust side stores
/// and retrieves them without interpreting their fields.
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSnapshot {
    pub providers: Vec<Value>,
    pub agents: Vec<Value>,
    pub default_agent_id: String,
    pub secrets: Vec<ProviderSecretState>,
    /// Entries that were present in `agents.json` but could not be
    /// deserialised. The renderer shows them so the user can correct them.
    pub issues: Vec<String>,
}

/// The shape persisted to `agents.json`.
#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct PersistedAgentConfig {
    providers: Vec<Value>,
    agents: Vec<Value>,
    default_agent_id: String,
}

fn keyring_account(provider_id: &str) -> String {
    format!("provider:{provider_id}")
}

fn provider_ids(providers: &[Value]) -> Vec<String> {
    providers
        .iter()
        .filter_map(|p| p.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect()
}

fn secret_states(ids: &[String]) -> Vec<ProviderSecretState> {
    ids.iter()
        .map(|id| {
            let account = keyring_account(id);
            let configured = keyring::Entry::new(KEYRING_SERVICE, &account)
                .map(|e| e.get_password().is_ok())
                .unwrap_or(false);
            ProviderSecretState {
                provider_id: id.clone(),
                configured,
            }
        })
        .collect()
}

fn read_config(app: &AppHandle) -> Result<(PersistedAgentConfig, Vec<String>)> {
    let store = app.store("agents.json")?;
    let mut issues = Vec::new();

    let config = match store.get(STORE_KEY) {
        None => PersistedAgentConfig::default(),
        Some(v) => match serde_json::from_value(v) {
            Ok(c) => c,
            Err(e) => {
                issues.push(format!("agents.json 格式无效：{e}"));
                PersistedAgentConfig::default()
            }
        },
    };

    Ok((config, issues))
}

fn to_snapshot(config: PersistedAgentConfig, issues: Vec<String>) -> AgentConfigSnapshot {
    let ids = provider_ids(&config.providers);
    let secrets = secret_states(&ids);
    AgentConfigSnapshot {
        providers: config.providers,
        agents: config.agents,
        default_agent_id: config.default_agent_id,
        secrets,
        issues,
    }
}

fn save_config(app: &AppHandle, config: &PersistedAgentConfig) -> Result<()> {
    let store = app.store("agents.json")?;
    store.set(STORE_KEY, serde_json::to_value(config)?);
    store.save()?;
    Ok(())
}

/// Loads the full configuration snapshot.
///
/// A missing or corrupt `agents.json` is not a failure: it returns an
/// empty configuration with any parse problems in `issues`.
///
/// # Errors
///
/// Returns an error when the store plugin cannot be opened.
#[command]
#[specta::specta]
pub async fn agent_config_get(app: AppHandle) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// Replaces the provider list and writes the result back to `agents.json`.
///
/// # Errors
///
/// Returns an error when the store cannot be written.
#[command]
#[specta::specta]
pub async fn agent_config_save_providers(
    app: AppHandle,
    providers: Vec<Value>,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let (mut config, issues) = read_config(&app)?;
        config.providers = providers;
        save_config(&app, &config)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// Replaces the agent list and default agent, then writes the result back.
///
/// # Errors
///
/// Returns an error when the store cannot be written.
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

/// Writes an API key to the system keychain for the given provider.
///
/// The secret never touches disk. Only `configured: true` reaches the
/// renderer in the returned snapshot.
///
/// # Errors
///
/// Returns an error when the keychain entry cannot be created or stored.
#[command]
#[specta::specta]
pub async fn agent_config_set_secret(
    app: AppHandle,
    provider_id: String,
    value: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let account = keyring_account(&provider_id);
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
            .map_err(|e| Error::Internal(e.to_string()))?;
        entry
            .set_password(&value)
            .map_err(|e| Error::Internal(e.to_string()))?;
        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}

/// Removes an API key from the system keychain for the given provider.
///
/// Absence of a credential is treated as success. The snapshot returned
/// reflects `configured: false` for this provider.
///
/// # Errors
///
/// Returns an error only when the keychain itself cannot be reached.
#[command]
#[specta::specta]
pub async fn agent_config_clear_secret(
    app: AppHandle,
    provider_id: String,
) -> AgentConfigCommandResult<AgentConfigSnapshot> {
    (|| -> Result<AgentConfigSnapshot> {
        let account = keyring_account(&provider_id);
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &account) {
            // Not-present is not an error; the desired state is the same.
            let _ = entry.delete_credential();
        }
        let (config, issues) = read_config(&app)?;
        Ok(to_snapshot(config, issues))
    })()
    .map_err(IpcError::from)
}
