//! The model list, read from the file the agent itself reads.
//!
//! Two rules shape this module.
//!
//! The list is never ours. Kimi Code keeps its models in the configuration
//! file below the home directory, so the interface offers what that file
//! contains. A list maintained on this side would be a second opinion about
//! something the agent already knows, and it would be wrong the moment the
//! user edits the file by hand.
//!
//! A configuration file is edited, never rewritten. The document is parsed
//! with `toml_edit` so comments, ordering and every key we do not understand
//! survive a change of model, and the new text only takes the place of the
//! old one once it is complete and on disk.

use std::fs::{self, File};
use std::io::{ErrorKind, Write as _};
use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;
use toml_edit::{DocumentMut, Item, Value};

/// The directory the agent keeps its data in, below the home directory.
const CONFIG_DIR: &str = ".kimi-code";

/// The configuration file inside that directory.
const CONFIG_FILE: &str = "config.toml";

/// The key naming the model a new session starts with.
const DEFAULT_MODEL: &str = "default_model";

/// The table every configured model appears in.
const MODELS: &str = "models";

/// The key inside a model entry naming the provider it is reached through.
const PROVIDER: &str = "provider";

/// The key inside a model entry naming what the provider answers to.
const MODEL: &str = "model";

/// The copy of the file kept beside it before it is replaced.
const BACKUP: &str = "config.toml.bak";

/// The file the new text is written to before the rename.
const TEMP: &str = "config.toml.new";

/// What is reported when the path handed in has no directory to write into.
const NO_DIRECTORY: &str = "the configuration file has no directory";

/// Why a model could not be listed or chosen.
#[derive(Debug, Error)]
pub enum ModelError {
    /// The file is there, but reading it failed.
    #[error("the agent configuration file could not be read: {0}")]
    Unreadable(String),
    /// The file is not valid TOML.
    #[error("the agent configuration file is not valid TOML: {0}")]
    Malformed(String),
    /// No model in the file carries that name.
    #[error("the agent has no model named {0}")]
    Unknown(String),
    /// The replacement could not be written.
    ///
    /// The failure is carried as it arrived rather than flattened into a
    /// message here. An io error already names what went wrong, and the
    /// caller is the one that decides how much of it the user should read.
    #[error("the agent configuration file could not be written: {0}")]
    Unwritable(#[from] std::io::Error),
}

/// One model the agent has been configured with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    /// The key the configuration file uses, which is what selects the model.
    pub id: String,
    /// What the provider answers to, which is what the user recognises.
    pub label: String,
    /// The provider the model is reached through, when the file names one.
    pub provider: Option<String>,
}

/// The models the agent knows, in the order the file lists them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    /// Every configured model.
    pub models: Vec<AgentModel>,
    /// The model a new session starts with, when the file names one.
    pub active: Option<String>,
}

/// Where the agent keeps its configuration, below a home directory.
pub fn config_path(home: &Path) -> PathBuf {
    home.join(CONFIG_DIR).join(CONFIG_FILE)
}

/// Reads the models the agent has been configured with.
///
/// A missing file is not a failure. An agent that has never been configured
/// has nothing to offer, and an empty list is the honest answer; refusing
/// here would turn a fresh installation into an error screen.
///
/// # Errors
///
/// Fails when the file exists but cannot be read or parsed.
pub fn read_models(path: &Path) -> Result<ModelList, ModelError> {
    let Some(parsed) = document(path)? else {
        return Ok(ModelList {
            models: Vec::new(),
            active: None,
        });
    };

    Ok(list(&parsed))
}

/// Chooses the model a new session will start with.
///
/// # Errors
///
/// Fails when the file cannot be read or parsed, when no model carries that
/// name, or when the replacement cannot be written.
pub fn select_model(path: &Path, id: &str) -> Result<ModelList, ModelError> {
    let Some(mut parsed) = document(path)? else {
        return Err(ModelError::Unknown(id.to_owned()));
    };

    // The answer to a name the file does not contain is a refusal. Writing it
    // anyway would leave the user with a configuration that starts nothing.
    let known = parsed
        .get(MODELS)
        .and_then(Item::as_table_like)
        .is_some_and(|table| table.get(id).is_some());

    if !known {
        return Err(ModelError::Unknown(id.to_owned()));
    }

    let _replaced = parsed.insert(DEFAULT_MODEL, Item::Value(Value::from(id)));

    save(path, &parsed)?;

    Ok(list(&parsed))
}

/// Parses the file, or reports that there is none.
fn document(path: &Path) -> Result<Option<DocumentMut>, ModelError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(ModelError::Unreadable(error.to_string())),
    };

    let parsed = text
        .parse::<DocumentMut>()
        .map_err(|error| ModelError::Malformed(error.to_string()))?;

    Ok(Some(parsed))
}

/// Reads the list out of a parsed document.
fn list(parsed: &DocumentMut) -> ModelList {
    let active = parsed
        .get(DEFAULT_MODEL)
        .and_then(Item::as_str)
        .map(str::to_owned);

    let mut models = Vec::new();

    if let Some(table) = parsed.get(MODELS).and_then(Item::as_table_like) {
        for (id, entry) in table.iter() {
            let fields = entry.as_table_like();

            let provider = fields
                .and_then(|entries| entries.get(PROVIDER))
                .and_then(Item::as_str)
                .map(str::to_owned);

            // An entry without a model name is still selectable, so the key
            // stands in as the label rather than the entry being dropped.
            let label = fields
                .and_then(|entries| entries.get(MODEL))
                .and_then(Item::as_str)
                .unwrap_or(id);

            // The order is the order of the file. Sorting here would show a
            // list the agent never wrote.
            models.push(AgentModel {
                id: id.to_owned(),
                label: label.to_owned(),
                provider,
            });
        }
    }

    ModelList { models, active }
}

/// Replaces the file, keeping a copy of what was there.
fn save(path: &Path, parsed: &DocumentMut) -> Result<(), ModelError> {
    let directory = path
        .parent()
        .ok_or_else(|| ModelError::Unwritable(std::io::Error::other(NO_DIRECTORY)))?;

    let backup = directory.join(BACKUP);
    let temp = directory.join(TEMP);
    let text = parsed.to_string();

    fs::copy(path, &backup).map_err(ModelError::Unwritable)?;

    // A half-written configuration file stops the agent from starting at all,
    // which is worse than a failed switch, so the new text is complete and
    // flushed before it takes the place of the old one.
    let mut file = File::create(&temp).map_err(ModelError::Unwritable)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);

    fs::rename(&temp, path).map_err(ModelError::Unwritable)
}
