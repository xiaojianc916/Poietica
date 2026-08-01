//! External URL and file opener.
//!
//! Planned: verify scheme, capability, origin before opening.
//! @architecture-stub: Phase 1.

use crate::Result;

#[derive(Debug, Clone)]
pub struct OpenOptions {
    pub url: String,
    pub new_window: bool,
}

/// Open a URL in the default system browser.
pub fn open_url(_options: OpenOptions) -> Result<()> {
    Ok(()) // stub
}

/// Show a file in the system file manager.
pub fn show_in_folder(_path: &str) -> Result<()> {
    Ok(()) // stub
}
