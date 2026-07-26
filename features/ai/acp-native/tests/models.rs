#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]

//! The model list, against the file Kimi Code writes for itself.
//!
//! The sample is shortened but never reshaped: quoted section keys, an
//! account whose name is not its kind, and several keys this code has no
//! opinion about and must not disturb.

use std::fs;
use std::path::PathBuf;

use poietica_ai_acp_native::{
    ModelError, model_config_path as config_path, read_models, select_model,
};
use tempfile::{TempDir, tempdir};

const CONFIG: &str = concat!(
    "default_model = \"moonshot-cn/kimi-k2.6\"\n",
    "\n",
    "[loop_control]\n",
    "max_retries_per_step = 3\n",
    "\n",
    "[thinking]\n",
    "enabled = true\n",
    "\n",
    "# the account, whose name is not its kind\n",
    "[providers.moonshot-cn]\n",
    "type = \"kimi\"\n",
    "api_key = \"sk-secret\"\n",
    "base_url = \"https://api.moonshot.cn/v1\"\n",
    "\n",
    "[models.\"moonshot-cn/kimi-k2.7-code\"]\n",
    "provider = \"moonshot-cn\"\n",
    "model = \"kimi-k2.7-code\"\n",
    "max_context_size = 262144\n",
    "capabilities = [ \"thinking\", \"tool_use\" ]\n",
    "\n",
    "[models.\"moonshot-cn/kimi-k2.6\"]\n",
    "provider = \"moonshot-cn\"\n",
    "model = \"kimi-k2.6\"\n",
    "max_context_size = 262144\n",
    "\n",
    "[models.\"moonshot-cn/kimi-k3\"]\n",
    "provider = \"moonshot-cn\"\n",
    "model = \"kimi-k3\"\n",
    "max_context_size = 1048576\n",
    "support_efforts = [ \"low\", \"high\", \"max\" ]\n",
    "default_effort = \"max\"\n",
);

/// Lays a sample down in a home of its own and hands back both.
///
/// The directory is returned because dropping it deletes the file, and a
/// test that lost its own fixture halfway through would fail for the wrong
/// reason.
fn home(text: &str) -> (TempDir, PathBuf) {
    let directory = tempdir().expect("a temporary home");
    let path = config_path(directory.path());

    fs::create_dir_all(path.parent().expect("a parent")).expect("the agent directory");
    fs::write(&path, text).expect("the configuration file");

    (directory, path)
}

#[test]
fn the_identifier_is_the_key_and_the_label_is_the_model_name() {
    let (_home, path) = home(CONFIG);

    let list = read_models(&path).expect("the list");

    assert_eq!(list.active.as_deref(), Some("moonshot-cn/kimi-k2.6"));
    assert_eq!(list.models.len(), 3);

    // The order is the file order, which is the order a person arranged.
    let first = list.models.first().expect("a first model");

    assert_eq!(first.id, "moonshot-cn/kimi-k2.7-code");
    assert_eq!(first.label, "kimi-k2.7-code");

    let newest = list.models.last().expect("a last model");

    assert_eq!(newest.id, "moonshot-cn/kimi-k3");
    assert_eq!(newest.label, "kimi-k3");
}

#[test]
fn the_mark_comes_from_the_provider_type_and_not_the_account_name() {
    let (_home, path) = home(CONFIG);

    let list = read_models(&path).expect("the list");

    for model in &list.models {
        assert_eq!(model.provider.as_deref(), Some("kimi"), "{model:?}");
    }
}

#[test]
fn an_account_with_no_section_falls_back_to_its_name() {
    let (_home, path) = home(concat!(
        "[models.\"acme/fast\"]\n",
        "provider = \"acme\"\n",
        "model = \"fast\"\n",
    ));

    let list = read_models(&path).expect("the list");
    let only = list.models.first().expect("a model");

    assert_eq!(only.provider.as_deref(), Some("acme"));
    assert_eq!(list.active, None);
}

#[test]
fn choosing_a_model_changes_that_one_line_and_nothing_else() {
    let (_home, path) = home(CONFIG);

    let list = select_model(&path, "moonshot-cn/kimi-k3").expect("the switch");

    assert_eq!(list.active.as_deref(), Some("moonshot-cn/kimi-k3"));

    let text = fs::read_to_string(&path).expect("the file");

    assert!(text.contains("default_model = \"moonshot-cn/kimi-k3\""), "{text}");
    assert!(!text.contains("default_model = \"moonshot-cn/kimi-k2.6\""), "{text}");

    // Everything the agent owns, and we do not understand, is still there.
    assert!(text.contains("api_key = \"sk-secret\""), "{text}");
    assert!(text.contains("# the account, whose name is not its kind"), "{text}");
    assert!(text.contains("[thinking]"), "{text}");
    assert!(text.contains("capabilities = [ \"thinking\", \"tool_use\" ]"), "{text}");
    assert!(text.contains("support_efforts = [ \"low\", \"high\", \"max\" ]"), "{text}");
    assert!(text.contains("default_effort = \"max\""), "{text}");
    assert!(text.contains("[models.\"moonshot-cn/kimi-k2.6\"]"), "{text}");

    let directory = path.parent().expect("a parent");

    assert!(directory.join("config.toml.bak").exists());
    assert!(!directory.join("config.toml.new").exists());
}

#[test]
fn a_model_the_agent_does_not_have_is_refused() {
    let (_home, path) = home(CONFIG);

    let refused = select_model(&path, "openai/gpt-5").expect_err("a refusal");

    assert!(matches!(refused, ModelError::Unknown(_)), "{refused:?}");

    // A refusal that had already written something would be the worst of
    // both: a file the agent cannot start from, and a switch that failed.
    assert_eq!(fs::read_to_string(&path).expect("the file"), CONFIG);
    assert!(!path.with_file_name("config.toml.bak").exists());
}

#[test]
fn an_agent_that_was_never_configured_offers_nothing() {
    let directory = tempdir().expect("a temporary home");

    let list = read_models(&config_path(directory.path())).expect("an empty list");

    assert!(list.models.is_empty());
    assert_eq!(list.active, None);
}
