//! Regenerates TypeScript DTO bindings from Rust document IPC contracts.
//!
//! Usage:
//! cargo run -p poietica-desktop --bin export-ipc-bindings

fn main() {
    poietica_desktop_lib::ipc::export_bindings::export_document_bindings();
}
