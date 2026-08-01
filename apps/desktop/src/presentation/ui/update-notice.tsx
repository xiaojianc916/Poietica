import type { SettingsStore } from '@poietica/features-settings'
import { Button, Dialog, Progress } from '@poietica/foundations-design-system'
import type { AppUpdateController, UpdateRelease } from '@poietica/platforms-desktop-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'

/* 与此前原生侧的 CHECK_EVERY 相同，节流现在只有这一份。 */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/* 启动后不立刻检查：首屏还在装配，一个网络往返没有理由和它抢。 */
const FIRST_CHECK_DELAY_MS = 30_000

const BYTES_PER_MEGABYTE = 1_048_576

type UpdateState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'available'; readonly release: UpdateRelease }
  | {
      readonly phase: 'installing'
      readonly release: UpdateRelease
      readonly downloaded: number
      readonly total: number | null
    }
  | { readonly phase: 'restarting'; readonly release: UpdateRelease }
  | { readonly phase: 'failed'; readonly release: UpdateRelease; readonly reason: string }

export interface UpdateNoticeProps {
  readonly controller: AppUpdateController
  readonly settings: SettingsStore
}

/**
 * 更新提示。
 *
 * 此前这块界面是 tauri_plugin_dialog 的一个系统 message box：拿不到应用的主题与
 * 令牌，装不下发布说明，更装不下进度 —— 下载进度当时只落在日志里，用户点完
 * "安装"看到的就是一个静止的界面。
 *
 * 现在它是一个普通的应用内对话框。下载期间 busy，Escape 与遮罩都不生效：正在写
 * 磁盘的安装包不该被一次误点丢掉；失败时停在同一个对话框里给出原因和重试，而不是
 * 悄悄回到"什么都没发生"。
 */
export function UpdateNotice({ controller, settings }: UpdateNoticeProps) {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  const stateRef = useRef<UpdateState>(state)
  const declinedRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    /*
     * 开发构建不检查更新：开发跑的版本号来自工作区，任何已发布版本都比它"新"，
     * 结果是每六小时提示一次一个装不上的更新。原生侧此前的 debug_assertions
     * 早返回是同一个判断，现在只剩这一处。
     */
    if (import.meta.env.DEV) {
      return
    }

    let active = true

    const check = async () => {
      /* 一次只处理一个更新：提示开着或正在下载时不再发起检查。 */
      if (!active || stateRef.current.phase !== 'idle') {
        return
      }

      const permitted = await settings
        .load()
        .then((loaded) => loaded.privacy.updateCheck)
        .catch(() => false)

      if (!permitted || !active) {
        return
      }

      /*
       * 后台检查失败保持安静：离线是常态，为它弹一个提示只是噪音。人主动触发的
       * 检查才需要回话，那个入口还没有。
       */
      const release = await controller.check().catch(() => null)

      if (!active || release === null || release.version === declinedRef.current) {
        return
      }

      setState({ phase: 'available', release })
    }

    const first = window.setTimeout(() => {
      void check()
    }, FIRST_CHECK_DELAY_MS)

    const repeat = window.setInterval(() => {
      void check()
    }, CHECK_EVERY_MS)

    return () => {
      active = false
      window.clearTimeout(first)
      window.clearInterval(repeat)
    }
  }, [controller, settings])

  const install = useCallback(() => {
    const current = stateRef.current

    if (current.phase !== 'available' && current.phase !== 'failed') {
      return
    }

    const release = current.release

    setState({ phase: 'installing', release, downloaded: 0, total: null })

    void controller
      .install((progress) => {
        setState({
          phase: 'installing',
          release,
          downloaded: progress.downloaded,
          total: progress.total ?? null,
        })
      })
      .then(
        () => {
          setState({ phase: 'restarting', release })
        },
        (cause: unknown) => {
          setState({ phase: 'failed', release, reason: reasonOf(cause) })
        },
      )
  }, [controller])

  const dismiss = useCallback(() => {
    const current = stateRef.current

    if (current.phase === 'installing' || current.phase === 'restarting') {
      return
    }

    if (current.phase !== 'idle') {
      /* 同一个版本不再提示，直到有更新的一个。 */
      declinedRef.current = current.release.version
    }

    setState({ phase: 'idle' })
  }, [])

  if (state.phase === 'idle') {
    return null
  }

  const busy = state.phase === 'installing' || state.phase === 'restarting'

  return (
    <Dialog
      busy={busy}
      className="!max-w-[28rem]"
      closeOnOverlayClick={false}
      description={descriptionOf(state)}
      footer={<footer className="flex justify-end gap-2.5">{actionsOf(state, install, dismiss)}</footer>}
      onOpenChange={(open) => {
        if (!open) {
          dismiss()
        }
      }}
      open
      showCloseButton={false}
      title={\`Poietica \${state.release.version} 可以更新\`}
    >
      <div className="px-5 pb-2">{bodyOf(state)}</div>
    </Dialog>
  )
}

function descriptionOf(state: Exclude<UpdateState, { phase: 'idle' }>): string {
  switch (state.phase) {
    case 'available':
      return '安装完成后应用会自动重启。'
    case 'installing':
      return '正在下载新版本，请保持应用打开。'
    case 'restarting':
      return '下载完成，安装器已接手。'
    case 'failed':
      return '这次更新没有完成，当前版本未被改动。'
  }
}

function bodyOf(state: Exclude<UpdateState, { phase: 'idle' }>) {
  switch (state.phase) {
    case 'available':
      return state.release.notes === null || state.release.notes === undefined ? null : (
        <p className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground text-sm leading-6">
          {state.release.notes}
        </p>
      )

    case 'installing':
      return (
        <Progress
          label={state.total === null ? '下载中' : megabytes(state.downloaded, state.total)}
          value={percentOf(state.downloaded, state.total)}
          valueLabel={percentLabel(percentOf(state.downloaded, state.total))}
        />
      )

    case 'restarting':
      return <Progress label="即将重启" value={100} valueLabel="100%" />

    case 'failed':
      return <p className="text-danger text-sm leading-6">{state.reason}</p>
  }
}

function actionsOf(
  state: Exclude<UpdateState, { phase: 'idle' }>,
  onInstall: () => void,
  onDismiss: () => void,
) {
  if (state.phase === 'installing' || state.phase === 'restarting') {
    return null
  }

  return (
    <>
      <Button
        className="bg-accent/55 px-3 hover:bg-accent"
        onClick={onDismiss}
        type="button"
        variant="ghost"
      >
        稍后
      </Button>

      <Button onClick={onInstall} type="button">
        {state.phase === 'failed' ? '重试' : '立即更新'}
      </Button>
    </>
  )
}

function percentOf(downloaded: number, total: number | null): number | null {
  if (total === null || total <= 0) {
    return null
  }

  return Math.min(100, Math.round((downloaded / total) * 100))
}

function percentLabel(percent: number | null): string {
  return percent === null ? '' : \`\${percent}%\`
}

function megabytes(downloaded: number, total: number): string {
  const done = (downloaded / BYTES_PER_MEGABYTE).toFixed(1)
  const all = (total / BYTES_PER_MEGABYTE).toFixed(1)

  return \`\${done} / \${all} MB\`
}

/*
 * 原生侧的错误在 IPC 上是一个 IpcError，它的 message 已经按 error.rs 那张表脱敏。
 * 正因为脱敏，它不适合直接贴到这里：更新失败落在 Plugin 变体上，那张表给它的话
 * 是"插件操作失败"——对着一个更新对话框说这五个字，等于什么都没说。所以这里按
 * code 分类，把它翻译成这个场景里说得通的一句话；具体原因在原生日志里。
 */
function reasonOf(cause: unknown): string {
  if (codeOf(cause) === 'not-found') {
    return '这个版本已经不在更新源上了，请稍后再试。'
  }

  return '下载或安装失败，当前版本没有被改动。'
}

function codeOf(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return undefined
  }

  const code = (cause as { readonly code?: unknown }).code

  return typeof code === 'string' ? code : undefined
}
