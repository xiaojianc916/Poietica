//! The list of models the agent has, which is a file and not a protocol.
//!
//! Protocol v1 has no request for the model, so there is nothing to ask
//! over the connection, and a slash command sent through a prompt is only a
//! sentence addressed to the agent. What does exist is the file the agent
//! reads when it starts. That file is the list, and choosing a model means
//! editing exactly one key of it.
//!
//! The file belongs to the agent. It is parsed and rewritten with
//! `toml_edit` so comments, ordering, and every key we do not understand
//! survive untouched; only `default_model` is ever assigned.
//!
//! What the real file looks like:
//!
//! ```toml
//! default_model = "moonshot-cn/kimi-k2.6"
//!
//! [providers.moonshot-cn]
//! type = "kimi"
//! api_key = "sk-..."
//!
//! [models."moonshot-cn/kimi-k2.6"]
//! provider = "moonshot-cn"
//! model = "kimi-k2.6"
//! max_context_size = 262144
//! ```
//!
//! Three facts follow from that shape, and getting any of them wrong shows
//! up on screen. The identifier is the section key, quoted in the file
//! because it holds a slash and a dot, and it is what `default_model` must
//! name. The readable name is the shorter `model` value inside the section.
//! And the mark to draw belongs to the KIND of provider, in
//! `[providers.<account>]` under `type`, not to the account name: an
//! account named moonshot-cn is a provider of type kimi, and it is the type
//! that has an icon.

use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use thiserror::Error;
use toml_edit::{DocumentMut, Item, TableLike, Value};

/// The directory the agent keeps its configuration in, under the home.
const CONFIG_DIR: &str = ".kimi-code";

/// The configuration file itself.
const CONFIG_FILE: &str = "config.toml";

/// The one key a switch assigns.
const DEFAULT_MODEL: &str = "default_model";

/// The table each configured model has a section in.
const MODELS: &str = "models";

/// The table each configured account has a section in.
const PROVIDERS: &str = "providers";

/// The key naming which account a model is reached through.
const PROVIDER: &str = "provider";

/// The key naming the kind of account, which is what carries the mark.
const KIND: &str = "type";

/// The key naming the model as its provider knows it.
const MODEL: &str = "model";

/// The copy kept beside the file before it is replaced.
const BACKUP: &str = "config.toml.bak";

/// The file the new text is written to before the rename.
const TEMP: &str = "config.toml.new";

/// What is reported when the path handed in has no directory to write into.
const NO_DIRECTORY: &str = "the configuration file has no directory";

/// Why the list could not be read, or a choice could not be made.
#[derive(Debug, Error)]
pub enum ModelError {
    /// The file is there but could not be read.
    #[error("the agent configuration file could not be read: {0}")]
    Unreadable(String),

    /// The file is not TOML.
    #[error("the agent configuration file is not valid TOML: {0}")]
    Malformed(String),

    /// A model was named that the file does not declare.
    #[error("the agent has no model named {0}")]
    Unknown(String),

    /// The replacement could not be written.
    ///
    /// The failure is carried as it arrived rather than flattened into a
    /// message here. An io error already names what went wrong, and the
    /// caller is the one that decides how much of it a user should read.
    #[error("the agent configuration file could not be written: {0}")]
    Unwritable(#[from] std::io::Error),
}

/// One model the agent can be pointed at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentModel {
    /// The section key, which is what `default_model` names.
    pub id: String,

    /// The readable name, taken from `model` inside the section.
    pub label: String,

    /// The kind of provider it is reached through, when the file says.
    pub provider: Option<String>,
}

/// The list, and which of it is in force.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ModelList {
    /// In the order the file gives them, which is the order a person set.
    pub models: Vec<AgentModel>,

    /// The identifier `default_model` names, when it names one.
    pub active: Option<String>,
}

/// Where the agent keeps its configuration, given a home directory.
#[must_use]
pub fn config_path(home: &Path) -> PathBuf {
    home.join(CONFIG_DIR).join(CONFIG_FILE)
}

/// Reads the models the agent declares.
///
/// An agent that was never configured has no file, and no file is an empty
/// list rather than a failure: nothing is wrong, there is simply nothing to
/// offer yet.
/// # Errors
///
/// Returns [`ModelError::Unreadable`] when the file cannot be opened, and
/// [`ModelError::Malformed`] when its contents are not TOML we can walk.
/// A file that exists but declares no models is not an error: it is an
/// empty list.
pub fn read_models(path: &Path) -> Result<ModelList, ModelError> {
    let Some(parsed) = document(path)? else {
        return Ok(ModelList::default());
    };

    Ok(list(&parsed))
}

/// Points the agent at one of its own models, and reports the new state.
///
/// A name the file does not declare is refused before anything is written: a
/// `default_model` naming a section that does not exist stops the agent from
/// starting at all, which is far worse than a refused switch.
/// # Errors
///
/// Returns [`ModelError::Unknown`] when the agent declares no model under
/// that identifier, in which case the file is left byte for byte as it
/// was, and [`ModelError::Unwritable`] when the replacement could not be
/// put in place. Reading the file first can fail for its own reasons.
pub fn select_model(path: &Path, id: &str) -> Result<ModelList, ModelError> {
    let Some(mut parsed) = document(path)? else {
        return Err(ModelError::Unknown(id.to_owned()));
    };

    if declared(&parsed, id).is_none() {
        return Err(ModelError::Unknown(id.to_owned()));
    }

    // Assigning an existing key keeps its place in the file. A file that
    // never had the key gets it among the other top level keys, which is
    // where TOML renders them: before the first section, never inside one.
    parsed.insert(DEFAULT_MODEL, Item::Value(Value::from(id)));
    save(path, &parsed)?;

    Ok(list(&parsed))
}

/// The section a model identifier names, if the file has one.
fn declared<'file>(parsed: &'file DocumentMut, id: &str) -> Option<&'file Item> {
    parsed
        .get(MODELS)
        .and_then(Item::as_table_like)
        .and_then(|table| table.get(id))
}

/// Parses the file, if there is one.
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

/// Reads the list out of a parsed file.
fn list(parsed: &DocumentMut) -> ModelList {
    let active = parsed.get(DEFAULT_MODEL).and_then(Item::as_str).map(str::to_owned);
    let providers = parsed.get(PROVIDERS).and_then(Item::as_table_like);
    let mut models = Vec::new();

    if let Some(table) = parsed.get(MODELS).and_then(Item::as_table_like) {
        for (id, section) in table.iter() {
            let fields = section.as_table_like();

            let account = fields
                .and_then(|entries| entries.get(PROVIDER))
                .and_then(Item::as_str);

            // The mark belongs to the kind of provider, not to the name this
            // machine gave the account. The account name stands in only when
            // the provider section is missing, which is a broken file we can
            // still show something useful for.
            let provider = account
                .and_then(|key| kind(providers, key))
                .or(account)
                .map(str::to_owned);

            let label = fields
                .and_then(|entries| entries.get(MODEL))
                .and_then(Item::as_str)
                .unwrap_or(id);

            models.push(AgentModel {
                id: id.to_owned(),
                label: label.to_owned(),
                provider,
            });
        }
    }

    ModelList { models, active }
}

/// Reads the type of a named account, which is what carries the mark.
fn kind<'file>(providers: Option<&'file dyn TableLike>, key: &str) -> Option<&'file str> {
    providers
        .and_then(|table| table.get(key))
        .and_then(Item::as_table_like)
        .and_then(|section| section.get(KIND))
        .and_then(Item::as_str)
}

/// Replaces the file, keeping a copy and never leaving a half written one.
fn save(path: &Path, parsed: &DocumentMut) -> Result<(), ModelError> {
    let directory = path
        .parent()
        .ok_or_else(|| ModelError::Unwritable(std::io::Error::other(NO_DIRECTORY)))?;

    let backup = directory.join(BACKUP);
    let temp = directory.join(TEMP);
    let text = parsed.to_string();

    fs::copy(path, &backup).map_err(ModelError::Unwritable)?;

    // A half written configuration file stops the agent from starting at
    // all, which is worse than a failed switch, so the new text is complete
    // and flushed before it takes the place of the old one.
    let mut file = File::create(&temp).map_err(ModelError::Unwritable)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);

    fs::rename(&temp, path).map_err(ModelError::Unwritable)
}
