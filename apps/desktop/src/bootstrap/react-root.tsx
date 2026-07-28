import { AppShell } from '@poietica/agent-ui'
import type { Root } from 'react-dom/client'
import { createRoot } from 'react-dom/client'
import { FatalErrorHost } from '../fatal/FatalErrorHost'
import { markReactFatalHostMounted, reportFatalIncident } from '../fatal/fatal-runtime'
import { createApplicationRuntime } from './application'

export interface MountedReactApplication {
  readonly runtime: ReturnType<typeof createApplicationRuntime>
  readonly unmount: () => Promise<void>
}

export function mountReactApplication(container: HTMLElement): MountedReactApplication {
  let runtime: ReturnType<typeof createApplicationRuntime>

  try {
    runtime = createApplicationRuntime({
      tldrawLicenseKey: readTldrawLicenseKey(),
    })
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

function readTldrawLicenseKey(): string {
  const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY?.trim()

  if (!licenseKey) {
    throw new Error('Required tldraw license configuration is missing.')
  }

  return licenseKey
}
