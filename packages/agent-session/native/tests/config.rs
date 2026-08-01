//! The selectors a real agent sent us, translated.
//!
//! The sample below is the answer Kimi Code CLI 0.29.1 gave to a new
//! session, copied from the wire.

use agent_client_protocol::schema::v1::SessionConfigOption;
use poietica_agent_runtime_native::{ConfigControl, ConfigPurpose, controls};

const OFFERED: &str = r#"[
  {"type":"select","id":"model","name":"Model","category":"model",
   "currentValue":"moonshot-cn/kimi-k2.6","options":[
     {"value":"moonshot-cn/kimi-k2.7-code-highspeed",
      "name":"kimi-k2.7-code-highspeed"},
     {"value":"moonshot-cn/kimi-k2.6","name":"kimi-k2.6"},
     {"value":"moonshot-cn/kimi-k2.7-code","name":"kimi-k2.7-code"},
     {"value":"moonshot-cn/kimi-k2.5","name":"kimi-k2.5"},
     {"value":"moonshot-cn/kimi-k3","name":"kimi-k3"}]},
  {"type":"select","id":"thinking","name":"Thinking",
   "category":"thought_level","currentValue":"on","options":[
     {"value":"off","name":"Off"},{"value":"on","name":"On"}]},
  {"type":"select","id":"mode","name":"Mode","category":"mode",
   "currentValue":"default","options":[
     {"value":"default","name":"Default",
      "description":"Manual approvals; tools execute normally."},
     {"value":"plan","name":"Plan",
      "description":"Read-only planning; no tool execution."},
     {"value":"auto","name":"Auto",
      "description":"Fully autonomous - agent decides everything."},
     {"value":"yolo","name":"YOLO",
      "description":"Auto-approve tool actions, but it may still ask."}]}
]"#;

const GROUPED: &str = r#"[
  {"type":"select","id":"model","name":"Model","category":"model",
   "currentValue":"a","options":[
     {"group":"one","name":"House","options":[
        {"value":"a","name":"A"},{"value":"b","name":"B"}]},
     {"group":"two","name":"Guest","options":[
        {"value":"c","name":"C"}]}]}
]"#;

fn parse(text: &str) -> Result<Vec<SessionConfigOption>, serde_json::Error> {
    serde_json::from_str(text)
}

fn named<'a>(list: &'a [ConfigControl], id: &str) -> Option<&'a ConfigControl> {
    list.iter().find(|control| control.id == id)
}

#[test]
fn the_agent_offers_three_selectors() -> Result<(), serde_json::Error> {
    let offered = controls(&parse(OFFERED)?);
    let ids: Vec<&str> = offered.iter().map(|control| control.id.as_str()).collect();

    assert_eq!(ids, vec!["model", "thinking", "mode"]);

    Ok(())
}

#[test]
fn each_selector_knows_what_it_is_for() -> Result<(), serde_json::Error> {
    let offered = controls(&parse(OFFERED)?);

    assert!(named(&offered, "model").is_some_and(|c| c.purpose == ConfigPurpose::Model));
    assert!(named(&offered, "mode").is_some_and(|c| c.purpose == ConfigPurpose::Mode));
    assert!(named(&offered, "thinking").is_some_and(|c| c.purpose == ConfigPurpose::Thought));

    Ok(())
}

#[test]
fn the_values_in_force_are_carried_across() -> Result<(), serde_json::Error> {
    let offered = controls(&parse(OFFERED)?);

    assert!(named(&offered, "model").is_some_and(|c| c.current == "moonshot-cn/kimi-k2.6"));
    assert!(named(&offered, "mode").is_some_and(|c| c.current == "default"));

    Ok(())
}

#[test]
fn every_value_on_offer_is_kept() -> Result<(), serde_json::Error> {
    let offered = controls(&parse(OFFERED)?);

    assert!(named(&offered, "model").is_some_and(|c| c.choices.len() == 5));
    assert!(named(&offered, "thinking").is_some_and(|c| c.choices.len() == 2));
    assert!(named(&offered, "mode").is_some_and(|c| c.choices.len() == 4));

    Ok(())
}

#[test]
fn the_agent_explains_its_own_modes() -> Result<(), serde_json::Error> {
    let offered = controls(&parse(OFFERED)?);
    let said = Some("Read-only planning; no tool execution.");

    assert!(named(&offered, "mode").is_some_and(|control| {
        control
            .choices
            .iter()
            .any(|choice| choice.value == "plan" && choice.detail.as_deref() == said)
    }));

    Ok(())
}

#[test]
fn grouped_values_arrive_as_one_run() -> Result<(), serde_json::Error> {
    let offered = controls(&parse(GROUPED)?);
    let names: Vec<String> = offered
        .iter()
        .flat_map(|control| control.choices.iter().map(|choice| choice.value.clone()))
        .collect();

    assert_eq!(names, vec!["a", "b", "c"]);

    Ok(())
}
