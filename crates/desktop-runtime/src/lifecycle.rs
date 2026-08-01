//! Application lifecycle management.
//!
//! @architecture-stub: Phase 2.

use crate::Result;

/// Request the application to quit gracefully.
pub fn request_quit() -> Result<()> {
    Ok(()) // stub
}

/// If running as a single-instance app, bring the existing window to front.
pub fn focus_existing_instance() -> Result<()> {
    Ok(()) // stub
}
