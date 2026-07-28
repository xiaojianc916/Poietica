import './app.css'

import {
  type MainWindowController,
  type NativeCrashReport,
  takePreviousNativeCrashReport,
} from '@poietica/platforms-desktop-runtime'
import { mountReactApplication } from './bootstrap/react-root'
import { reportFatalIncident } from './fatal/fatal-runtime'
import { installScrollbarActivity } from './presentation/chrome/scrollbar-activity'

void bootstrapApplication()

async function bootstrapApplication(): Promise<void> {
  installScrollbarActivity()

  const previousCrash = await readPreviousNativeCrashReport()

  if (previousCrash) {
    // 呈现由 pre-react-entry 的崩溃屏负责：React 在这条路径上不会挂载。
    reportPreviousNativeCrash(previousCrash)
    return
  }

  const mounted = mountReactApplication(getApplicationRoot())

  presentWhenPainted(mounted.runtime.mainWindow)
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
function presentWhenPainted(mainWindow: MainWindowController): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void mainWindow.present().catch((cause: unknown) => {
        console.error('[Poietica] Failed to present the main window', cause)
      })
    })
  })
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

function reportPreviousNativeCrash(report: NativeCrashReport): void {
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
