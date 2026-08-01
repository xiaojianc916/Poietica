import { RefreshAlt } from '@mynaui/icons-react'
import type { SettingsStore } from '@poietica/features-settings'
import { ConfirmationDialog } from '@poietica/foundations-design-system'
import type { AppUpdateController, UpdateRelease } from '@poietica/platforms-desktop-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'

import { reportFailure } from '../../application/failures/failure-policy'

/* 与此前原生侧的 CHECK_EVERY 相同，节流现在只有这一份。 */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/* 启动后不立刻检查：首屏还在装配，一个网络往返没有理由和它抢。 */
const FIRST_CHECK_DELAY_MS = 30_000

type CapsuleState =
  | { readonly phase: 'hidden' }
  | { readonly phase: 'available'; readonly release: UpdateRelease }
  | {
      readonly phase: 'downloading'
      readonly release: UpdateRelease
      readonly downloaded: number
      readonly total: number | null
    }
  | { readonly phase: 'ready'; readonly release: UpdateRelease }

export interface UpdateCapsuleProps {
  readonly controller: AppUpdateController
  readonly settings: SettingsStore
}

/**
 * 侧栏底部的更新胶囊。
 *
 * 此前这块界面是 tauri_plugin_dialog 的一个系统 message box：拿不到应用的主题与
 * 令牌，装不下进度，而且它是模态的——一个后台任务在你打字的时候夺走焦点，问你
 * 要不要现在重启。
 *
 * 现在它是角落里的一枚胶囊，三态原地切换，不移动、不夺焦、不遮挡。
 *
 * 它不能被关闭，这是刻意的，也是 VS Code（齿轮蓝点）、Chrome（菜单变色）、
 * Zed 与 Slack 一致的做法：能不能关取决于打不打扰，而一个 28px 的角落控件不抢
 * 任何东西。给它一个关闭按钮只有一个后果——第一次看见就被顺手关掉，此后再也
 * 收不到安全更新。
 */
export function UpdateCapsule({ controller, settings }: UpdateCapsuleProps) {
  const [state, setState] = useState<CapsuleState>({ phase: 'hidden' })
  const [confirming, setConfirming] = useState(false)

  const stateRef = useRef<CapsuleState>(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    /*
     * 开发构建不检查更新：开发跑的版本号来自工作区，任何已发布版本都比它"新"，
     * 结果是每六小时提示一次一个装不上的更新。
     */
    if (import.meta.env.DEV) {
      return
    }

    let active = true

    const check = async () => {
      /* 一次只处理一个更新：已经现身或正在下载时不再发起检查。 */
      if (!active || stateRef.current.phase !== 'hidden') {
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
       * 后台检查失败保持安静：离线是常态，为它报一次失败只是噪音。下载失败不同，
       * 那是人按下按钮之后的事，必须回话。
       */
      const release = await controller.check().catch(() => null)

      if (!active || release === null) {
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

  const startDownload = useCallback(() => {
    const current = stateRef.current

    if (current.phase !== 'available') {
      return
    }

    const release = current.release

    setState({ phase: 'downloading', release, downloaded: 0, total: null })

    void controller
      .download((progress) => {
        setState({
          phase: 'downloading',
          release,
          downloaded: progress.downloaded,
          total: progress.total ?? null,
        })
      })
      .then(
        () => {
          setState({ phase: 'ready', release })
        },
        (cause: unknown) => {
          reportFailure('UPDATE_DOWNLOAD_FAILED', {
            cause,
            scope: 'update-capsule',
            operation: 'download-update',
            version: release.version,
          })

          /* 退回可点状态：这枚胶囊本身就是重试入口。 */
          setState({ phase: 'available', release })
        },
      )
  }, [controller])

  const relaunch = useCallback(() => {
    setConfirming(false)

    void controller.relaunch().catch((cause: unknown) => {
      reportFailure('UPDATE_DOWNLOAD_FAILED', {
        cause,
        scope: 'update-capsule',
        operation: 'install-update',
      })
    })
  }, [controller])

  if (state.phase === 'hidden') {
    return null
  }

  const percent = state.phase === 'downloading' ? percentOf(state.downloaded, state.total) : null

  return (
    <>
      <button
        aria-label={labelOf(state)}
        aria-valuenow={percent ?? undefined}
        className={CAPSULE_CLASS}
        disabled={state.phase === 'downloading'}
        onClick={() => {
          if (state.phase === 'available') {
            startDownload()
          }

          if (state.phase === 'ready') {
            setConfirming(true)
          }
        }}
        role={state.phase === 'downloading' ? 'progressbar' : undefined}
        type="button"
      >
        {/*
          进度就是胶囊自己被填满的过程，不额外占一行也不改变布局宽度。
          总长未知时（服务端没给 Content-Length）保持在 0：一根乱跳的假进度条
          比没有进度条更糟，那时靠文字说"下载中"。
        */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-foreground/10 transition-[width] duration-200 ease-out"
          style={{ width: widthOf(percent) }}
        />

        {state.phase === 'downloading' ? null : (
          <RefreshAlt aria-hidden="true" className="relative size-3.5" />
        )}

        <span className="relative">{labelOf(state)}</span>
      </button>

      <ConfirmationDialog
        cancelLabel="稍后"
        confirmLabel="重启"
        description="应用会立刻关闭并以新版本重新打开。没有保存的内容会丢失。"
        onCancel={() => {
          setConfirming(false)
        }}
        onConfirm={relaunch}
        open={confirming}
        title="重启以完成更新"
      />
    </>
  )
}

const CAPSULE_CLASS = [
  'relative flex h-7 shrink-0 items-center gap-1.5 overflow-hidden',
  'rounded-full border border-divider px-2.5',
  'font-medium text-foreground text-xs',
  'transition-colors hover:bg-sidebar-accent',
  'disabled:cursor-default',
].join(' ')

function labelOf(state: Exclude<CapsuleState, { phase: 'hidden' }>): string {
  switch (state.phase) {
    case 'available':
      return ['更新到', state.release.version].join(' ')

    case 'downloading': {
      const percent = percentOf(state.downloaded, state.total)

      return percent === null ? '下载中' : [String(percent), '%'].join('')
    }

    case 'ready':
      return '重启以完成更新'
  }
}

function percentOf(downloaded: number, total: number | null): number | null {
  if (total === null || total <= 0) {
    return null
  }

  return Math.min(100, Math.round((downloaded / total) * 100))
}

function widthOf(percent: number | null): string {
  return percent === null ? '0%' : [String(percent), '%'].join('')
}
