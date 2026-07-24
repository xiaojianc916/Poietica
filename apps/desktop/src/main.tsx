import './app.css'

import {
  takePreviousNativeCrashReport,
  type NativeCrashReport,
} from '@hybrid-canvas/platforms-desktop-runtime'
import { installApplicationLifecycle } from './bootstrap/application-lifecycle'
import { mountReactApplication } from './bootstrap/react-root'
import { reportFatalIncident } from './fatal/fatal-runtime'

void bootstrapApplication()

async function bootstrapApplication(): Promise<void> {
  const previousCrash = await readPreviousNativeCrashReport()

  if (previousCrash) {
    reportPreviousNativeCrash(previousCrash)
    return
  }

  const mounted = mountReactApplication(getApplicationRoot())

  installApplicationLifecycle(mounted.runtime, mounted)
}

async function readPreviousNativeCrashReport(): Promise<NativeCrashReport | null> {
  try {
    return await takePreviousNativeCrashReport()
  } catch (error: unknown) {
    // Failure to inspect an old crash report must not prevent a healthy
    // application startup. The current failure remains visible in native logs.
    console.error('[Hybrid Canvas] Failed to inspect previous native crash report', error)

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
