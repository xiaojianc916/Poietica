use std::collections::HashMap;

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionId, PermissionOptionKind, RequestPermissionRequest,
};

/// What the client will answer a permission request with.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Decision {
    /// Approve, by selecting one of the agent's own approval options.
    Allow(PermissionOptionId),
    /// Refuse, by selecting one of the agent's own refusal options.
    Reject(PermissionOptionId),
    /// Refuse without selecting an option, which the protocol reserves for a
    /// turn that ended before anyone answered.
    Cancel,
}

impl Decision {
    /// The option that was chosen, when one was.
    #[must_use]
    pub const fn option_id(&self) -> Option<&PermissionOptionId> {
        match self {
            Self::Allow(option_id) | Self::Reject(option_id) => Some(option_id),
            Self::Cancel => None,
        }
    }
}

/// Answers a permission request without asking anyone.
///
/// This is the fallback for the cases where nobody can be asked: a request
/// that arrives outside a turn, or a desk that is unusable. An unattended
/// client that approves file writes and shell commands is a worse failure than
/// one that declines them, and expressing the refusal with the agent's own
/// option lets the agent tell it apart from an abandoned turn.
#[must_use]
pub fn decide(request: &RequestPermissionRequest) -> Decision {
    let rejection = pick(&request.options, PermissionOptionKind::RejectOnce)
        .or_else(|| pick(&request.options, PermissionOptionKind::RejectAlways));

    match rejection {
        Some(option_id) => Decision::Reject(option_id),
        None => Decision::Cancel,
    }
}

/// The answers the user is allowed to give, keyed by option identifier.
///
/// Whether an option approves or refuses is the agent's classification, not
/// ours. An identifier absent from this map was never offered, which is how an
/// answer arriving from the interface is checked before it is acted on.
#[must_use]
pub fn answers(request: &RequestPermissionRequest) -> HashMap<String, Decision> {
    request
        .options
        .iter()
        .map(|option| (option.option_id.to_string(), classify(option)))
        .collect()
}

/// The kind enum grows with the protocol, and a kind this build does not know
/// is treated as a refusal: the safe reading of an unknown option is not to
/// take it for consent.
fn classify(option: &PermissionOption) -> Decision {
    match option.kind {
        PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways => {
            Decision::Allow(option.option_id.clone())
        }
        _ => Decision::Reject(option.option_id.clone()),
    }
}

fn pick(options: &[PermissionOption], wanted: PermissionOptionKind) -> Option<PermissionOptionId> {
    options
        .iter()
        .find(|option| option.kind == wanted)
        .map(|option| option.option_id.clone())
}
