//! System theme detection (light / dark / high-contrast).
//!
//! @architecture-stub: Phase 1.

use crate::Result;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Theme {
    Light,
    Dark,
    HighContrast,
}

/// Detect the OS-level theme preference.
pub fn system_theme() -> Result<Theme> {
    Ok(Theme::Light) // stub
}

/// Subscribe to system theme changes. The returned handle unsubscribes when dropped.
pub fn on_theme_change(_callback: Box<dyn Fn(Theme) + Send>) -> Result<ThemeSubscription> {
    Ok(ThemeSubscription)
}

#[derive(Debug)]
pub struct ThemeSubscription;
