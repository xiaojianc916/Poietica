//! OS-level information: platform, version, locale, hostname.
//!
//! @architecture-stub: Phase 1.

use crate::Result;

#[derive(Debug)]
pub struct RuntimeInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub locale: String,
    pub hostname: Option<String>,
}

/// Gather runtime information from the OS.
pub fn collect() -> Result<RuntimeInfo> {
    Ok(RuntimeInfo {
        os: std::env::consts::OS.to_string(),
        os_version: "unknown".to_string(),
        arch: std::env::consts::ARCH.to_string(),
        locale: "en-US".to_string(),
        hostname: None,
    })
}
