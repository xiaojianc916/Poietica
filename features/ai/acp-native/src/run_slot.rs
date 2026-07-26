use std::sync::{Arc, Mutex};

use crate::error::{AcpError, Result};
use crate::recorder::Recorder;

const OCCUPIED: &str = "a run is already being recorded on this session";

/// The run that arriving session updates belong to.
///
/// The protocol handlers are installed once, for the whole connection. A
/// recorder exists only for the run it records. Those two lifetimes do not
/// match, so the handlers cannot own a recorder: they hold this slot instead.
///
/// An update that arrives outside a turn is dropped rather than attributed to
/// whichever run happened to come before it.
#[derive(Clone, Debug, Default)]
pub struct RunSlot {
    current: Arc<Mutex<Option<Recorder>>>,
}

impl RunSlot {
    /// An empty slot, recording nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Makes this recorder the destination for the updates that follow.
    ///
    /// # Errors
    ///
    /// Fails when a run is still being recorded, which is how a second
    /// concurrent turn is refused, and when the lock was poisoned.
    pub fn install(&self, recorder: Recorder) -> Result<()> {
        let mut current = self
            .current
            .lock()
            .map_err(|_poisoned| AcpError::RecorderPoisoned)?;

        if current.is_some() {
            return Err(AcpError::Protocol {
                message: OCCUPIED.to_owned(),
            });
        }

        *current = Some(recorder);

        Ok(())
    }

    /// Ends the routing and hands the recorder back so the run can be closed.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned.
    pub fn take(&self) -> Result<Option<Recorder>> {
        let mut current = self
            .current
            .lock()
            .map_err(|_poisoned| AcpError::RecorderPoisoned)?;

        Ok(current.take())
    }

    /// Applies an action to the current run, reporting whether there was one.
    pub fn record(&self, action: impl FnOnce(&mut Recorder)) -> bool {
        match self.current.lock() {
            Ok(mut current) => match current.as_mut() {
                Some(recorder) => {
                    action(recorder);

                    true
                }
                None => false,
            },
            // A poisoned lock means another task panicked. A protocol handler
            // has nothing useful to tell the agent about that, so the update is
            // dropped and the driver reports the failure it already holds.
            Err(_poisoned) => false,
        }
    }

    /// Whether a run is currently being recorded.
    pub fn is_recording(&self) -> bool {
        self.current.lock().is_ok_and(|current| current.is_some())
    }
}
