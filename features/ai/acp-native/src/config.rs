//! The configuration selectors a session offers.
//!
//! The agent decides which selectors exist, what they are called, and
//! which values each one will accept. This module only carries them
//! across, so that no list of models, reasoning levels or modes is ever
//! written down on our side.

use agent_client_protocol::schema::v1::SessionConfigKind;
use agent_client_protocol::schema::v1::SessionConfigOption;
use agent_client_protocol::schema::v1::SessionConfigOptionCategory;
use agent_client_protocol::schema::v1::SessionConfigSelectOption;
use agent_client_protocol::schema::v1::SessionConfigSelectOptions;

/// What a selector is for, as far as the agent was willing to say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigPurpose {
    /// How much freedom the agent takes during a turn.
    Mode,
    /// Which model answers.
    Model,
    /// How long the model deliberates before answering.
    Thought,
    /// Something the agent named itself, or nothing at all.
    Other,
}

/// One value a selector will accept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigChoice {
    /// The value to send back when this one is picked.
    pub value: String,
    /// The name the agent gave it.
    pub label: String,
    /// The longer sentence the agent gave, where it gave one.
    pub detail: Option<String>,
}

/// One selector, with every value it accepts and the one in force.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigControl {
    /// The name the agent answers to when the value is changed.
    pub id: String,
    /// The name the agent gave this selector.
    pub label: String,
    /// The longer sentence the agent gave, where it gave one.
    pub detail: Option<String>,
    /// Where this selector belongs on screen.
    pub purpose: ConfigPurpose,
    /// The value in force right now.
    pub current: String,
    /// Every value on offer, groups flattened into one run.
    pub choices: Vec<ConfigChoice>,
}

fn to_purpose(category: Option<&SessionConfigOptionCategory>) -> ConfigPurpose {
    match category {
        Some(SessionConfigOptionCategory::Mode) => ConfigPurpose::Mode,
        Some(SessionConfigOptionCategory::Model) => ConfigPurpose::Model,
        Some(SessionConfigOptionCategory::ThoughtLevel) => ConfigPurpose::Thought,
        Some(_) | None => ConfigPurpose::Other,
    }
}

fn to_choice(offer: &SessionConfigSelectOption) -> ConfigChoice {
    ConfigChoice {
        value: offer.value.to_string(),
        label: offer.name.clone(),
        detail: offer.description.clone(),
    }
}

// Written with `if let` rather than `match` on purpose: the protocol may
// add shapes here, and neither a closed match nor a catch-all arm stays
// correct across that change.
fn to_choices(offers: &SessionConfigSelectOptions) -> Vec<ConfigChoice> {
    if let SessionConfigSelectOptions::Ungrouped(list) = offers {
        return list.iter().map(to_choice).collect();
    }

    if let SessionConfigSelectOptions::Grouped(groups) = offers {
        return groups
            .iter()
            .flat_map(|group| group.options.iter().map(to_choice))
            .collect();
    }

    Vec::new()
}

fn to_control(offered: &SessionConfigOption) -> Option<ConfigControl> {
    let SessionConfigKind::Select(select) = &offered.kind else {
        return None;
    };

    Some(ConfigControl {
        id: offered.id.to_string(),
        label: offered.name.clone(),
        detail: offered.description.clone(),
        purpose: to_purpose(offered.category.as_ref()),
        current: select.current_value.to_string(),
        choices: to_choices(&select.options),
    })
}

/// Carries across every selector we know how to render.
///
/// A selector of a shape we do not recognise is left out rather than
/// guessed at, which is what the protocol asks a client to do.
#[must_use]
pub fn controls(offered: &[SessionConfigOption]) -> Vec<ConfigControl> {
    offered.iter().filter_map(to_control).collect()
}
