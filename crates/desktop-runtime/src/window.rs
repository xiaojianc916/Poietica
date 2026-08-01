//! Window management — size, position, decorations, visibility.
//!
//! @architecture-stub: Phase 1.

use crate::Result;

pub struct WindowHandle;

/// Set the window frame decorations (native title bar vs. client-side).
pub fn set_decorations(_decorated: bool) -> Result<()> {
    Ok(()) // stub
}

/// Set the window to fullscreen or windowed.
pub fn set_fullscreen(_fullscreen: bool) -> Result<()> {
    Ok(()) // stub
}

/// Move the window to the given screen coordinate.
pub fn set_position(_x: f64, _y: f64) -> Result<()> {
    Ok(()) // stub
}

/// Resize the window.
pub fn set_size(_width: f64, _height: f64) -> Result<()> {
    Ok(()) // stub
}

/// Returns whether the window is currently in fullscreen mode.
pub fn is_fullscreen() -> Result<bool> {
    Ok(false)
}
