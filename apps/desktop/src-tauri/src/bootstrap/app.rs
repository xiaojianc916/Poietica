use tauri::{Manager, Wry, async_runtime};
use tauri_plugin_store::StoreExt;

use super::{logging, tray};
use crate::asset_protocol::{ASSET_PROTOCOL_SCHEME, AssetProtocolRegistry};
use crate::commands;
use crate::commands::document::DocumentRegistry;

pub fn build() -> tauri::Builder<Wry> {
    let asset_protocol = AssetProtocolRegistry::default();
    let protocol_registry = asset_protocol.clone();

    tauri::Builder::<Wry>::default()
        .manage(DocumentRegistry::default())
        .manage(asset_protocol)
        /*
         * A synchronous protocol handler is invoked by the platform webview on
         * its own thread, which is the UI thread on Windows and macOS. Building
         * a response takes the registry read lock and copies the asset, up to
         * MAX_ASSET_BYTES of it, so answering inline stalled painting and input
         * for the length of that copy on every cache miss.
         *
         * The copy cannot be removed. Tauri bounds a protocol response body by
         * Into<Cow<'static, [u8]>>, and an asset owned by the registry is not
         * 'static, so it can only be handed over as Cow::Owned. Sharing types
         * do not help. What can be fixed is which thread pays for it.
         *
         * The responder is Send, so the work moves to the blocking executor and
         * the webview thread returns immediately.
         */
        .register_asynchronous_uri_scheme_protocol(
            ASSET_PROTOCOL_SCHEME,
            move |_context, request, responder| {
                let registry = protocol_registry.clone();

                async_runtime::spawn_blocking(move || {
                    responder.respond(registry.response(&request));
                });
            },
        )
        .plugin(logging::plugin().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            app.store("settings.json")?;
            let _managed = app.manage(commands::agent::AgentRuntime::new(app.handle())?);
            crate::diagnostics::install(app.handle())?;
            tray::install(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_prompt,
            commands::agent::agent_cancel,
            commands::agent::agent_resolve_permission,
            commands::agent::agent_shutdown,
            commands::agent::agent_load_run,
            commands::asset::asset_session_open,
            commands::asset::asset_upload,
            commands::asset::asset_remove,
            commands::asset::asset_session_close,
            commands::diagnostics::diagnostics_take_previous_crash,
            commands::window::window_get,
            commands::window::window_list,
            commands::window::window_show,
            commands::window::window_focus,
            commands::window::window_close,
            commands::window::window_set_title,
            commands::window::window_save_state,
            commands::document::document_open,
            commands::document::document_save_as,
            commands::document::document_save,
            commands::document::document_close,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_reset,
        ])
}
