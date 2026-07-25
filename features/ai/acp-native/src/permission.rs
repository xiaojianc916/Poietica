use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionId, PermissionOptionKind, RequestPermissionRequest,
};

/// What the client will answer a permission request with.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Decision {
    /// Refuse by selecting one of the agent's own refusal options.
    Reject(PermissionOptionId),
    /// Refuse without selecting an option, which the protocol reserves for a
    /// turn that ended before anyone answered.
    Cancel,
}

/// Answers a permission request without asking anyone.
///
/// Until the surface that asks the user exists, the only defensible default is
/// refusal: an unattended client that approves file writes and shell commands
/// is a worse failure than one that declines them. The refusal is expressed
/// with the agent's own option so the agent can distinguish it from a turn that
/// was abandoned.
#[must_use]
pub fn decide(request: &RequestPermissionRequest) -> Decision {
    let rejection = pick(&request.options, PermissionOptionKind::RejectOnce)
        .or_else(|| pick(&request.options, PermissionOptionKind::RejectAlways));

    match rejection {
        Some(option_id) => Decision::Reject(option_id),
        None => Decision::Cancel,
    }
}

fn pick(options: &[PermissionOption], wanted: PermissionOptionKind) -> Option<PermissionOptionId> {
    options
        .iter()
        .find(|option| option.kind == wanted)
        .map(|option| option.option_id.clone())
}
