import {
  type AppSettings as AppSettingsDto,
  commands,
} from '@poietica/desktop-ipc/generated/ipc-bindings'
import type { AppSettings, SettingsStore, ThemeMode } from '@poietica/settings'

export function createDesktopSettingsStore(): SettingsStore {
  return {
    async load() {
      const dto = await commands.settingsGet()

      return fromDto(dto)
    },

    async save(settings) {
      await commands.settingsSet(toDto(settings))
    },

    async reset() {
      const dto = await commands.settingsReset()

      return fromDto(dto)
    },
  }
}

function fromDto(dto: AppSettingsDto): AppSettings {
  return {
    theme: parseTheme(dto.theme),
    language: dto.language,
    autoSave: dto.auto_save,
    autoSaveIntervalMs: dto.auto_save_interval,
    shortcuts: normalizeShortcuts(dto.shortcuts),
    canvas: {
      defaultZoom: dto.canvas.default_zoom,
      showGrid: dto.canvas.show_grid,
      snapToGrid: dto.canvas.snap_to_grid,
      gridSize: dto.canvas.grid_size,
      showRulers: dto.canvas.show_rulers,
      infiniteCanvas: dto.canvas.infinite_canvas,
    },
    editor: {
      fontFamily: dto.editor.font_family,
      fontSize: dto.editor.font_size,
      lineHeight: dto.editor.line_height,
      tabSize: dto.editor.tab_size,
      insertSpaces: dto.editor.insert_spaces,
      wordWrap: dto.editor.word_wrap,
      minimap: dto.editor.minimap,
    },
    export: {
      defaultFormat: dto.export.default_format,
      pngDpi: dto.export.png_dpi,
      pdfQuality: dto.export.pdf_quality,
      includeMetadata: dto.export.include_metadata,
    },
    privacy: {
      telemetry: dto.privacy.telemetry,
      crashReporting: dto.privacy.crash_reporting,
      updateCheck: dto.privacy.update_check,
    },
  }
}

function normalizeShortcuts(
  shortcuts: Partial<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(shortcuts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function toDto(settings: AppSettings): AppSettingsDto {
  return {
    theme: settings.theme,
    language: settings.language,
    auto_save: settings.autoSave,
    auto_save_interval: settings.autoSaveIntervalMs,
    shortcuts: { ...settings.shortcuts },
    canvas: {
      default_zoom: settings.canvas.defaultZoom,
      show_grid: settings.canvas.showGrid,
      snap_to_grid: settings.canvas.snapToGrid,
      grid_size: settings.canvas.gridSize,
      show_rulers: settings.canvas.showRulers,
      infinite_canvas: settings.canvas.infiniteCanvas,
    },
    editor: {
      font_family: settings.editor.fontFamily,
      font_size: settings.editor.fontSize,
      line_height: settings.editor.lineHeight,
      tab_size: settings.editor.tabSize,
      insert_spaces: settings.editor.insertSpaces,
      word_wrap: settings.editor.wordWrap,
      minimap: settings.editor.minimap,
    },
    export: {
      default_format: settings.export.defaultFormat,
      png_dpi: settings.export.pngDpi,
      pdf_quality: settings.export.pdfQuality,
      include_metadata: settings.export.includeMetadata,
    },
    privacy: {
      telemetry: settings.privacy.telemetry,
      crash_reporting: settings.privacy.crashReporting,
      update_check: settings.privacy.updateCheck,
    },
  }
}

function parseTheme(value: string): ThemeMode {
  switch (value) {
    case 'light':
    case 'dark':
    case 'system':
      return value
    default:
      return 'system'
  }
}
