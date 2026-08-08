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
/// A value nobody offers cannot be picked, so it cannot be shown as picked
/// either: the first offered value stands in, the same reset a select
/// performs when its value matches no option. What reaches this point
/// unoffered is a thought level the agent carried across a model change,
/// once carried_over has taken it back out of the list.
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

/// 思考档位是一条梯子，从不想到想得最久。
///
/// 档位的名字由 agent 起，但「哪一档比哪一档更用力」是这个应用自己的领域知识：
/// 协议不说，也不该说。认不出来的名字没有名次，于是一个没见过的档位永远不会被
/// 下面那条规则丢掉。
fn rung(value: &str) -> Option<u8> {
    match value {
        "off" | "none" => Some(0),
        "minimal" | "low" => Some(1),
        "medium" | "on" => Some(2),
        "high" => Some(3),
        "max" | "highest" => Some(4),
        _unnamed => None,
    }
}

/// 上一个模型的档位，被 agent 挂在了新模型候选集的末尾。
///
/// agent 整个会话只记一个思考档位。换模型时它把那个值原样带过来，并且为了让
/// current 仍然指得到一个候选项，把这个值追加在新模型自己那串的后面。实测三次
/// 切换：[off, on] 变成 [off, on, low]，[off, low, high, max] 变成
/// [off, low, high, max, on]，[off, high, max] 变成 [off, high, max, low]。
///
/// 梯子是单调的，所以这一项认得出来：它排在一个比它更用力的档位后面，而且它正是
/// agent 此刻报的值。两个条件缺一不可 —— 只看位置会错杀 [off, on] 里的 on，只看
/// 取值会错杀任何一张恰好选中最后一档的表。
fn carried_over(choices: &[ConfigChoice], reported: &str) -> bool {
    let [.., before, last] = choices else {
        return false;
    };

    if last.value != reported {
        return false;
    }

    let (Some(stronger), Some(weaker)) = (rung(&before.value), rung(&last.value)) else {
        return false;
    };

    weaker < stronger
}

fn to_control(offered: &SessionConfigOption) -> Option<ConfigControl> {
    let SessionConfigKind::Select(select) = &offered.kind else {
        return None;
    };

    let purpose = to_purpose(offered.category.as_ref());
    let mut choices = to_choices(&select.options);
    let reported = select.current_value.to_string();

    // 带过来的那一档不是新模型的候选项，所以它先出局；in_force 随后把这次选择
    // 落回新模型自己的第一档。
    if purpose == ConfigPurpose::Thought && carried_over(&choices, &reported) {
        choices.pop();
    }

    let current = in_force(&choices, &reported)?;

    Some(ConfigControl {
        id: offered.id.to_string(),
        label: offered.name.clone(),
        detail: offered.description.clone(),
        purpose,
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

/// 我们把档位落回去了，agent 还不知道。
///
/// controls 摘掉了新模型并不提供的那一档，于是屏幕上的档位与 agent 正在跑的那一
/// 档分了家：界面显示第一档，agent 仍按旧档思考。缓存与真相脱节比显示一个假档位
/// 更糟，所以这里说出唯一能合上这道口子的那一次请求 —— 把界面落到的值回告给
/// agent，真相仍然由它自己的下一份答复给出。
///
/// 没有分家时交回 None，那是绝大多数情况。
#[must_use]
pub fn correction(
    offered: &[SessionConfigOption],
    settled: &[ConfigControl],
) -> Option<(String, String)> {
    for control in settled {
        let Some(reported) = reported_value(offered, &control.id) else {
            continue;
        };

        if reported != control.current {
            return Some((control.id.clone(), control.current.clone()));
        }
    }

    None
}

/// The value the agent named for one selector, as it arrived.
fn reported_value(offered: &[SessionConfigOption], id: &str) -> Option<String> {
    for option in offered {
        if option.id.to_string() != id {
            continue;
        }

        let SessionConfigKind::Select(select) = &option.kind else {
            return None;
        };

        return Some(select.current_value.to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{ConfigChoice, carried_over, in_force};

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

    /// 一整条梯子，按 agent 报的次序。
    fn ladder(values: &[&str]) -> Vec<ConfigChoice> {
        values.iter().copied().map(choice).collect()
    }

    #[test]
    fn spots_the_level_the_agent_hung_on_the_end() {
        let choices = ladder(&["off", "high", "max", "low"]);

        assert!(carried_over(&choices, "low"));
    }

    #[test]
    fn spots_a_stronger_level_hung_on_a_longer_ladder() {
        let choices = ladder(&["off", "low", "high", "max", "on"]);

        assert!(carried_over(&choices, "on"));
    }

    #[test]
    fn leaves_a_two_rung_ladder_alone() {
        let choices = ladder(&["off", "on"]);

        assert!(!carried_over(&choices, "on"));
    }

    #[test]
    fn leaves_the_top_rung_alone() {
        let choices = ladder(&["off", "low", "high", "max"]);

        assert!(!carried_over(&choices, "max"));
    }

    #[test]
    fn a_rung_we_cannot_name_is_never_dropped() {
        let choices = ladder(&["max", "turbo"]);

        assert!(!carried_over(&choices, "turbo"));
    }
}
