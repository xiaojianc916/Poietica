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
    /// The value in force right now. Always one of the offered choices.
    pub current: String,
    /// Every value on offer, groups flattened into one run. Never empty.
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

/// Which of the offered values is in force.
///
/// The agent carries one thought level for the whole session and reports
/// it again after the model changes, so the value it names can be a level
/// the new model never offered. A value nobody offers cannot be picked, so
/// it cannot be shown as picked either: the first offered value stands in,
/// the same reset a select performs when its value matches no option.
///
/// None means the selector offers nothing at all, and a selector with
/// nothing to offer is not one a user can operate.
fn in_force(choices: &[ConfigChoice], reported: &str) -> Option<String> {
    choices
        .iter()
        .find(|choice| choice.value == reported)
        .or_else(|| choices.first())
        .map(|choice| choice.value.clone())
}

fn to_control(offered: &SessionConfigOption) -> Option<ConfigControl> {
    let SessionConfigKind::Select(select) = &offered.kind else {
        return None;
    };

    let choices = to_choices(&select.options);
    let reported = select.current_value.to_string();
    let current = in_force(&choices, &reported)?;

    Some(ConfigControl {
        id: offered.id.to_string(),
        label: offered.name.clone(),
        detail: offered.description.clone(),
        purpose: to_purpose(offered.category.as_ref()),
        current,
        choices,
    })
}

/// Carries across every selector we know how to render.
///
/// A selector of a shape we do not recognise, and a selector with nothing
/// to offer, are both left out rather than guessed at.
#[must_use]
pub fn controls(offered: &[SessionConfigOption]) -> Vec<ConfigControl> {
    offered.iter().filter_map(to_control).collect()
}

#[cfg(test)]
mod tests {
    use super::{ConfigChoice, in_force};

    fn choice(value: &str) -> ConfigChoice {
        ConfigChoice {
            value: value.to_owned(),
            label: value.to_owned(),
            detail: None,
        }
    }

    #[test]
    fn keeps_the_value_the_agent_offers() {
        let choices = [choice("low"), choice("high")];

        assert_eq!(in_force(&choices, "high"), Some("high".to_owned()));
    }

    #[test]
    fn drops_a_level_the_new_model_never_offered() {
        let choices = [choice("medium"), choice("high")];

        assert_eq!(in_force(&choices, "low"), Some("medium".to_owned()));
    }

    #[test]
    fn a_selector_with_nothing_to_offer_has_no_value() {
        assert_eq!(in_force(&[], "low"), None);
    }
}
