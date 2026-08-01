#![forbid(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]

//! Desktop runtime native capabilities.
//!
//! Planned responsibilities:
//! - window management (size, position, decorations)
//! - system menus and trays
//! - application lifecycle
//! - system theme detection
//! - runtime information (OS, version, locale)
//! - external URLs and file openers
//!
//! This crate is framework-agnostic. It must not import Tauri types.
//! Tauri-specific IPC is handled by `apps/desktop/src-tauri/commands/`.

mod error;
pub mod lifecycle;
pub mod opener;
pub mod runtime_info;
pub mod theme;
pub mod window;

pub use error::{Error, Result};
