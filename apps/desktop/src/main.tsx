import './app.css'

import {
  type MainWindowController,
  type NativeCrashReport,
  takePreviousNativeCrashReport,
} from '@poietica/desktop-adapters'
import { DEFAULT_APP_SETTINGS } from '@poietica/settings'
import { applyThemePreference } from '@poietica/ui'
import { mountReactApplication } from './bootstrap/react-root'
import { installContextMenuGuard } from './chrome/context-menu-guard'
import { installExternalLinks } from './chrome/external-links'
import { installScrollbarSize } from './chrome/scrollbar-size'
import { reportFatalIncident } from './failures/terminal-policy'

bootstrapApplication()

function bootstrapApplication(): void {
  installScrollbarSize()
  installExternalLinks()
  installContextMenuGuard()

  /*
   * 主题必须在第一帧之前落到文档上。
   *
   * 深色令牌挂在 :root[data-theme="dark"]，浅色挂在裸 :root（tokens/light.css）
   * —— 属性缺席时整套令牌无条件解成浅色，而 index.html 那份预 React 副本跟着
   * prefers-color-scheme 走，于是深色桌面的冷启动是「深 → 整屏白 → 深」两跳。
   *
   * 默认值一直写着 system，此前只是没有人在设置回来之前应用它，那段窗口里既
   * 不是存下的选择也不是默认值。这里不引入第二份状态：设置读回来之后
   * app-shell 再校一次，重复调用由 theme-controller 自己摘掉上一个 matchMedia
   * 监听。
   */
  applyThemePreference(DEFAULT_APP_SETTINGS.theme)

  /*
   * 首帧不排在任何一次原生往返之后。
   *
   * 上一次崩溃的报告要走一次 IPC 和一次磁盘读，而它与"这一次能不能画"无关：
   * 正常启动每一次都读到 null，却每一次都让挂载、布局与呈现计时一起往后挪。
   * 所以 React 先挂，报告并发去读，读到了交给已经在跑的那条致命管线
   * （reportFatalIncident → FatalErrorHost）——那也正是 pre-react-entry 在
   * isReactFatalHostMounted 之后让位的对象。一件事只剩一条路径。
   */
  const mounted = mountReactApplication(getApplicationRoot())

  presentWhenPainted(mounted.runtime.mainWindow)

  void reportPreviousNativeCrash()
}

/*
 * 窗口以 visible: false 创建，几何已在原生 setup 中恢复，呈现的时机在这里。
 *
 * 两帧：第一帧提交 DOM，第二帧之前浏览器完成绘制。此前 show() 在 Rust 的 setup
 * 里调用，那早于 webview 执行任何脚本，用户先看到的是一个空的背景色窗口。
 *
 * 若这里因为任何原因没能执行，原生侧的看门狗会在 8 秒后兜底呈现，不会留下一个
 * 永远不可见的进程。
 */
const PRESENT_DEADLINE_MS = 100

function presentWhenPainted(mainWindow: MainWindowController): void {
  let presented = false

  const present = (): void => {
    if (presented) {
      return
    }

    presented = true

    void mainWindow.present().catch((cause: unknown) => {
      console.error('[Poietica] Failed to present the main window', cause)
    })
  }

  /*
   * 两帧是理想路径：第一帧提交 DOM，第二帧之前浏览器完成绘制。
   *
   * 但窗口是 visible: false 创建的，而 requestAnimationFrame 在文档不可见时
   * 会被节流、甚至完全不触发 —— 那是规范行为，不是缺陷。只挂在 rAF 上，
   * 这条正常路径就没有保证，冷启动会落到原生侧那个 8 秒看门狗上，用户看到
   * 的是八秒的空窗。
   *
   * 所以两个信号赛跑，谁先到谁呈现：绘制完成，或者这个期限到了。
   */
  requestAnimationFrame(() => {
    requestAnimationFrame(present)
  })

  setTimeout(present, PRESENT_DEADLINE_MS)
}

async function readPreviousNativeCrashReport(): Promise<NativeCrashReport | null> {
  try {
    return await takePreviousNativeCrashReport()
  } catch (error: unknown) {
    // Failure to inspect an old crash report must not prevent a healthy
    // application startup. The current failure remains visible in native logs.
    console.error('[Poietica] Failed to inspect previous native crash report', error)

    return null
  }
}

async function reportPreviousNativeCrash(): Promise<void> {
  const report = await readPreviousNativeCrashReport()

  if (report === null) {
    return
  }

  const error = new Error(report.message)

  error.name = 'NativeProcessCrash'
  error.stack = [report.message, '', 'Native backtrace:', report.backtrace].join('\n')

  reportFatalIncident({
    impact: 'native-fatal',
    error,
    kind: 'native-crash',
    phase: 'preflight',
    code: 'FATAL_PREVIOUS_NATIVE_PROCESS_CRASH',
    title: '应用上次运行时异常终止',
    ...(report.location === null
      ? {}
      : {
          source: report.location,
        }),
    recovery: 'reload',
    context: {
      nativeIncidentId: report.incidentId,
      nativeOccurredAt: report.occurredAt,
      nativeProcess: report.process,
      nativeThread: report.thread,
      appVersion: report.appVersion,
      targetOs: report.targetOs,
      targetArch: report.targetArch,
    },
  })
}

function getApplicationRoot(): HTMLElement {
  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Application root element "#root" was not found.')
  }

  return root
}
