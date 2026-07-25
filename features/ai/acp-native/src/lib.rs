//! The Agent Client Protocol client, over a locally spawned agent process.
//!
//! Two rules shape this crate.
//!
//! Every session update is written to the encrypted log before it is handed to
//! anything else, so an interrupted run is replayable rather than lost.
//!
//! The protocol handlers never synthesise a protocol error out of one of our
//! own failures. A failed write is recorded and surfaced by the driver once the
//! run ends; reporting it back to the agent as a JSON-RPC error would invite it
//! to react to a fault that is not its own.

mod error;
mod permission;
mod recorder;
mod session;

pub use error::{AcpError, Result};
pub use permission::{decide, Decision};
pub use recorder::{
    RecordedEvent, Recorder, ACP_UPDATE, PERMISSION_REQUESTED, PERMISSION_RESOLVED, RUN_FAILED,
    RUN_FINISHED, RUN_STARTED,
};
pub use session::run_prompt;
