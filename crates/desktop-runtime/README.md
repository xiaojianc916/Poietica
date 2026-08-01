# Desktop Runtime Native

## Planned responsibility

Platform-level native capabilities shared across any desktop application build.

**Owned responsibilities:**
- Window management (size, position, decorations, visibility)
- External URL/file opener (with scheme/capability verification)
- Application lifecycle (quit, focus, single-instance)
- System theme detection (light/dark/high-contrast, change subscription)
- Runtime information (OS, version, architecture, locale)
- System menus, tray, and updater (future)

**Does NOT own:**
- Tauri IPC or Tauri commands
- Business logic of any domain
- Asset storage (editor/assets/native)
- File container (editor/persistence/native)
- Plugin verification (editor/extensions/native)

## Activation phase

Phase 1 (window, opener, theme, runtime_info) then Phase 2 (lifecycle, menu, tray, updater).

## Dependency rules

- Must not depend on Tauri
- Must not depend on any domain package
- May depend on std, serde, thiserror, tracing
