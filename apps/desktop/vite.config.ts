import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { customErrorDiagnosticsPlugin } from './vite-plugins/custom-error-diagnostics'

export default defineConfig({
  plugins: [
    // 必须最先注册，确保捕获后续插件及 import-analysis 错误。
    customErrorDiagnosticsPlugin(),
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      // 使用 Poietica 自己的错误界面，禁止显示 Vite 默认 Overlay。
      overlay: false,
    },
  },
  // Do not expose the complete TAURI_* environment namespace to WebView code.
  // Build-time Tauri variables remain available here through process.env.
  envPrefix: ['VITE_'],
  build: {
    manifest: true,
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
