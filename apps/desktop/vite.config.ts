import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { customErrorDiagnosticsPlugin } from './vite-plugins/custom-error-diagnostics'

/*
 * 许可证键是构建期常量。缺了它 react-root.tsx 会 throw，代价由终端用户以一块
 * 崩溃屏支付 —— 一个打包时就能判定的错误没有理由推迟到运行期。
 *
 * 只在 build 生效：本地没有键的贡献者仍然可以起开发服务器。
 */
function requireTldrawLicenseKey(): Plugin {
  return {
    name: 'poietica:require-tldraw-license-key',
    apply: 'build',
    config() {
      if (!process.env.VITE_TLDRAW_LICENSE_KEY) {
        throw new Error(
          'VITE_TLDRAW_LICENSE_KEY is required for a production build; the application throws on startup without it.',
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [
    // 必须最先注册，确保捕获后续插件及 import-analysis 错误。
    customErrorDiagnosticsPlugin(),
    requireTldrawLicenseKey(),
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
    // Tauri v2 renamed these: TAURI_PLATFORM/TAURI_DEBUG are v1 names, and
    // reading them silently downgraded the target and killed debug sourcemaps.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    /*
     * 压缩器是 oxc，因为打包器已经是 rolldown。
     *
     * Vite 8 不再依赖 esbuild：写 'esbuild' 只会把 vite:esbuild-transpile 拉进
     * renderChunk，然后在全部模块转换完之后因为找不到这个包而崩掉。为它单独装
     * 一个 esbuild 也不对——那是在 rolldown 旁边再养一条平行的转换实现，产物的
     * 语义来源就有了两个。降级仍由下面的 target 决定，oxc 照它工作。
     */
    minify: process.env.TAURI_ENV_DEBUG ? false : 'oxc',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
})
