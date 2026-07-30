import type { Root } from 'react-dom/client'
import { createRoot } from 'react-dom/client'
import { FatalErrorHost } from '../fatal/FatalErrorHost'
import { markReactFatalHostMounted, reportFatalIncident } from '../fatal/fatal-runtime'
import { AppShell } from '../presentation/AppShell'
import { createApplicationRuntime } from './application'

export interface MountedReactApplication {
  readonly runtime: ReturnType<typeof createApplicationRuntime>
  readonly unmount: () => Promise<void>
}

export function mountReactApplication(container: HTMLElement): MountedReactApplication {
  let runtime: ReturnType<typeof createApplicationRuntime>

  try {
    runtime = createApplicationRuntime()
  } catch (error: unknown) {
    reportFatalIncident({
      impact: 'application-fatal',
      error,
      kind: 'bootstrap',
      phase: 'runtime-construction',
      code: 'FATAL_APPLICATION_RUNTIME_CONSTRUCTION',
      context: {
        collector: 'react-root',
      },
    })

    throw error
  }

  const root: Root = createRoot(container)

  markReactFatalHostMounted()

  root.render(
    <FatalErrorHost>
      <AppShell runtime={runtime} />
    </FatalErrorHost>,
  )

  return {
    runtime,

    async unmount() {
      root.unmount()
      await runtime.dispose()
    },
  }
}
