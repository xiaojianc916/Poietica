use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use agent_client_protocol::schema::v1::RequestPermissionRequest;
use futures::channel::oneshot;

use crate::error::{AcpError, Result};
use crate::permission::{answers, Decision};

const UNKNOWN_REQUEST: &str = "that permission request is not outstanding";
const UNKNOWN_OPTION: &str = "that option was never offered for this permission request";
const HANDLER_GONE: &str = "the agent stopped waiting for that permission request";
const POISONED: &str = "the permission desk was left locked by a panicking task";

/// One request the agent is blocked on.
#[derive(Debug)]
struct Waiting {
    /// The answers the agent offered, by identifier.
    allowed: HashMap<String, Decision>,
    /// Where the answer is delivered.
    answer: oneshot::Sender<Decision>,
}

/// The permission requests waiting for a human.
///
/// The protocol handler and the interface never meet: the handler is inside a
/// connection that was built once, and the answer arrives later on a command.
/// The desk is the only thing they share, and it holds nothing but the promise
/// of an answer.
#[derive(Clone, Debug, Default)]
pub struct PermissionDesk {
    outstanding: Arc<Mutex<HashMap<String, Waiting>>>,
}

impl PermissionDesk {
    /// An empty desk.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a request and hands back the answer to await.
    ///
    /// # Errors
    ///
    /// Fails when the desk was left locked by a panicking task.
    pub fn wait(
        &self,
        request_id: &str,
        request: &RequestPermissionRequest,
    ) -> Result<oneshot::Receiver<Decision>> {
        let (answer, waiting) = oneshot::channel();

        let _replaced = self.lock()?.insert(
            request_id.to_owned(),
            Waiting {
                allowed: answers(request),
                answer,
            },
        );

        Ok(waiting)
    }

    /// Answers an outstanding request on the user's behalf.
    ///
    /// The answer is checked before the request is taken off the desk, so a
    /// nonsensical answer cannot destroy a request that is still legitimately
    /// waiting for a real one.
    ///
    /// # Errors
    ///
    /// Fails when the request is not outstanding, when the option was never
    /// offered, or when the agent has already stopped waiting.
    pub fn answer(&self, request_id: &str, option_id: &str) -> Result<()> {
        let mut outstanding = self.lock()?;

        let Some(waiting) = outstanding.get(request_id) else {
            return Err(protocol(UNKNOWN_REQUEST));
        };

        let Some(decision) = waiting.allowed.get(option_id).cloned() else {
            return Err(protocol(UNKNOWN_OPTION));
        };

        let Some(waiting) = outstanding.remove(request_id) else {
            return Err(protocol(UNKNOWN_REQUEST));
        };

        waiting
            .answer
            .send(decision)
            .map_err(|_gone| protocol(HANDLER_GONE))
    }

    /// Abandons every outstanding request.
    ///
    /// Each waiting handler observes the dropped sender and answers with the
    /// protocol's cancellation, which is exactly what an unanswered request at
    /// the end of a turn means.
    pub fn clear(&self) {
        if let Ok(mut outstanding) = self.outstanding.lock() {
            outstanding.clear();
        }
    }

    /// How many requests are waiting for an answer.
    #[must_use]
    pub fn waiting(&self) -> usize {
        self.outstanding
            .lock()
            .map_or(0, |outstanding| outstanding.len())
    }

    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, Waiting>>> {
        self.outstanding
            .lock()
            .map_err(|_poisoned| protocol(POISONED))
    }
}

fn protocol(message: &str) -> AcpError {
    AcpError::Protocol {
        message: message.to_owned(),
    }
}
