//! What the agent configuration file is allowed to do to us, and we to it.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]

use std::fs;

use poietica_ai_acp_native::{ModelError, read_models, select_model};
use tempfile::TempDir;

/// A file shaped like the one Kimi Code writes, comments and secrets included.
const CONFIG: &str = concat!(
    "default_model = \"k2\"\n",
    "\n",
    "# the account this machine uses\n",
    "[providers.moonshot]\n",
    "type = \"moonshot\"\n",
    "base_url = \"https://api.moonshot.cn/v1\"\n",
    "api_key = \"secret\"\n",
    "\n",
    "[models.k2]\n",
    "provider = \"moonshot\"\n",
    "model = \"kimi-k2.5\"\n",
    "\n",
    "[models.k15]\n",
    "provider = \"moonshot\"\n",
    "model = \"kimi-k1.5\"\n",
);

fn configured() -> (TempDir, std::path::PathBuf) {
    let directory = TempDir::new().expect("a temporary directory");
    let path = directory.path().join("config.toml");

    fs::write(&path, CONFIG).expect("the sample configuration is written");

    (directory, path)
}

#[test]
fn the_models_are_listed_in_the_order_the_file_gives_them() {
    let (_directory, path) = configured();

    let list = read_models(&path).expect("the sample configuration is readable");

    assert_eq!(list.active.as_deref(), Some("k2"));
    assert_eq!(list.models.len(), 2);

    let first = list.models.first().expect("the first model");
    assert_eq!(first.id, "k2");
    assert_eq!(first.label, "kimi-k2.5");
    assert_eq!(first.provider.as_deref(), Some("moonshot"));

    let second = list.models.get(1).expect("the second model");
    assert_eq!(second.id, "k15");
    assert_eq!(second.label, "kimi-k1.5");
}

#[test]
fn choosing_a_model_changes_that_one_line_and_nothing_else() {
    let (directory, path) = configured();

    let list = select_model(&path, "k15").expect("k15 is configured");
    assert_eq!(list.active.as_deref(), Some("k15"));

    let text = fs::read_to_string(&path).expect("the rewritten file is readable");

    assert!(text.contains("default_model = \"k15\""));
    assert!(text.contains("# the account this machine uses"));
    assert!(text.contains("api_key = \"secret\""));
    assert!(text.contains("[models.k2]"));

    // The original is kept beside the file, and the temporary one is gone.
    assert!(directory.path().join("config.toml.bak").exists());
    assert!(!directory.path().join("config.toml.new").exists());
}

#[test]
fn a_model_the_agent_does_not_have_is_refused() {
    let (_directory, path) = configured();

    let refused = select_model(&path, "gpt-5");
    assert!(matches!(refused, Err(ModelError::Unknown(_named))));

    let text = fs::read_to_string(&path).expect("the untouched file is readable");
    assert!(text.contains("default_model = \"k2\""));
}

#[test]
fn an_agent_that_was_never_configured_offers_nothing() {
    let directory = TempDir::new().expect("a temporary directory");
    let path = directory.path().join("config.toml");

    let list = read_models(&path).expect("a missing file is not a failure");

    assert!(list.models.is_empty());
    assert_eq!(list.active, None);
}
