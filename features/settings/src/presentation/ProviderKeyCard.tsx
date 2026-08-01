import {
  type AgentProviderPreset,
  agentProviderCatalogAddArgs,
  agentProviderCatalogDocument,
  builtinProviderDefaultModelId,
} from '@poietica/agent-registry'
import { Button, InlineSpinner } from '@poietica/foundations-design-system'
import { useCallback, useEffect, useState } from 'react'
import type { AgentConfigStore, ProviderKeyProbe } from '../ports/agent-config-store'
import { describeAgentCliExit, describeAgentCliFailure } from './agentCliText'
import { SubField } from './models-fields'

/*
 * 一家厂商的凭据卡。传进来的是 builtinAgentProviders 的一条。
 *
 * 上一版这张卡开开关就起一个子进程，问 agent「这家有哪些模型」。那条路作废了：agent 的
 * 目录命令每次都要现拉 models.dev，拉不到就直接失败，没有内置兜底。候选模型改成内置表，
 * 于是一打开这张卡就有清单 —— 不起进程、离线也有、也没有那句「正在询问…」。
 *
 * 开关本身也删了：它只决定表单显不显示，没有任何真语义（配没配过写在 agent 那边，
 * 拨它不改变任何事实）。一个拨了什么都不改变的控件是仪式，不是功能。
 *
 * 手填「基础地址」那一格删了。接口地址属于厂商身份，内置就够；Zed 也不把它放进密钥
 * 界面（api_url() 从设置里读，空则用常量）。真要改地址的场景是自建网关，那是另一类
 * provider，不该让每个填密钥的人都先看见一个空框。
 *
 * 「默认模型」那一格也删了，它搬去了这一页的顶层。配置里 default_model 是顶层唯一的一个
 * 键，一家一格必然有两格在说假话；而且那一格从不读配置、只在提交密钥的瞬间才有效，配好
 * 之后再拨它没有任何动作。Zed 的 AgentSettings 上也只有一个 default_model。
 *
 * 这张卡因此只剩它真正拥有的东西：这一家的密钥。
 *
 * 密钥不上命令行、不落我们的盘：随一次 execCli 经环境变量进子进程，写进 agent 自己的
 * 配置之后就与我们无关 —— 包括「配没配过」，答案在上面那张模型列表里。
 *
 * 写入走 agent 的 catalog add。它的目录只吃一个 http(s) 地址，默认目录 models.dev 在
 * 部分网络下不可达 —— 所以目录由我们自己供：把这家厂商的内置表按 api.json 形状序列化，
 * 随 execCli 交给原生侧，绑在一次性 loopback 服务上，用官方的 --url 喂给它。全程不碰
 * 外网、不解析对方的配置文件。
 */
/*
 * 多久算「慢」。到点不停动画 —— 停下来才是撒谎的那一半：写入其实还在跑，界面却说完了 ——
 * 而是多说一句实话。
 *
 * 这一次往返要起一个 Node 进程跑 agent 的 provider catalog add，进程启动是它的大头，
 * 正常几秒；到 8 秒还没回来，用户有权知道它卡在哪一步。
 */
const SLOW_WRITE_MS = 8000

/*
 * 一次探测的结论怎么说。
 *
 * 五种结论，只有一种说「密钥不对」。这不是措辞讲究，是判据本身：401 之外的任何
 * 一种都无法排除「密钥其实是对的」，说死了就是软件在撒谎。所以其余四种一律说
 * 「未验证」，并把真正的怀疑对象指出来（端点、网络、权限）。
 *
 * 每一句都以「已写入」开头：写入确实成功了，这一点不能被验证结论盖掉。
 */
function describeKeyVerdict(probe: ProviderKeyProbe, vendor: string): string {
  switch (probe.verdict) {
    case 'accepted':
      return '已写入 agent 自己的配置，密钥已验证。'
    case 'rejected':
      return `已写入，但这把密钥 ${vendor} 不认（HTTP 401）。请核对后重新填写。`
    case 'forbidden':
      return `已写入，密钥有效，但这个账号在 ${vendor} 没有访问权限（HTTP 403）。`
    case 'unsupported':
      return '已写入 agent 自己的配置。这家没有提供可用于校验的端点，密钥未验证。'
    default:
      return '已写入 agent 自己的配置。没能连上厂商接口（可能是网络或代理），密钥未验证。'
  }
}

export interface ProviderKeyCardProps {
  readonly store: AgentConfigStore
  readonly agentId: string
  readonly provider: AgentProviderPreset
  /** 档案声明的注入变量名。缺席时不写入，而不是自己挑一个名字。 */
  readonly registryKeyVar: string | undefined
  readonly onSaved: () => void
}

export function ProviderKeyCard({
  store,
  agentId,
  provider,
  registryKeyVar,
  onSaved,
}: ProviderKeyCardProps) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [waited, setWaited] = useState(false)

  /*
   * 与 busy 分开的第二个忙碌态。
   *
   * 它们不是同一件事：busy 期间配置还没写成，按钮该锁；verifying 期间配置已经写好、
   * onSaved 已经发出，用户完全可以继续做别的。合成一个变量就得在两处各判一次「这次
   * 是哪一半」，那比两个布尔更难读。
   */
  const [verifying, setVerifying] = useState(false)

  /*
   * 上一次的回执不该压在下一次的输入上：一动密钥，那句话就作废。
   *
   * 此前只有 submit 里清一次，于是「已写入 agent 自己的配置。」会和一个刚填了
   * 一半的新密钥同框 —— 那句话说的是上一次。
   */
  const editKey = useCallback((next: string) => {
    setApiKey(next)
    setMessage(null)
  }, [])

  /*
   * 这里没有「卸载后不 setState」那道守卫。
   *
   * React 18 起「卸载后 setState」不再是错误，那条警告本身已被官方删掉
   * （facebook/react#22114）。而它真该防的那件事它也防不住：这张卡的 key 是
   * provider id，换 agent 时组件不重建，于是在 A 上按下保存、立刻切到 B，回执会
   * 落在 B 的界面上 —— 那一刻组件还挂着，任何按卸载判断的守卫都会放行。换 agent
   * 的作废由外壳的 key={agentId} 整棵重建来做，见 AgentModels。
   */

  /*
   * 忙碌指示的唯一驱动是 busy，而 busy 只在 execCli 这一次真实往返期间为真：没有假进度、
   * 没有最小展示时长、请求没发出去就一次都不转（变量名缺席、密钥为空都在 setBusy 之前
   * return 了）。
   *
   * 计时器只负责补一句话，不负责停动画。busy 落下时把它一并复位，否则下一次写入会带着
   * 上一次的「还在等」开场。
   */
  useEffect(() => {
    if (!busy) {
      setWaited(false)
      return
    }

    const timer = setTimeout(() => {
      setWaited(true)
    }, SLOW_WRITE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [busy])

  const submit = useCallback(() => {
    if (registryKeyVar === undefined) {
      setMessage('这个 agent 没有声明该往哪个环境变量注入密钥，无法从这里写入。')
      return
    }

    const secret = apiKey.trim()

    if (secret.length === 0) {
      return
    }

    /*
     * 早退之后 registryKeyVar 已经不是 undefined 了，但那次收窄未必跟得进下面的
     * 闭包。落成一个本地 const，不指望编译器替我们记住。
     */
    const keyVar: string = registryKeyVar

    setBusy(true)
    setMessage(null)

    /*
     * 只在配置里还没有 default_model 时，才随这次 catalog add 一起把它写掉。
     *
     * 为什么必须写：上游 hasUsableConfiguredDefaultModel 第一行是 defaultModel 缺席
     * 即 return false（packages/acp-adapter/src/server.ts）。顶层没有这一行，配置里
     * 的 api_key 整条不算数，session/new 一律 authRequired。
     *
     * 此前这条路只写 provider、从不写 default_model —— 手填密钥写出的是一份当场不能
     * 用的配置，要等 agent-capability-store 的 ensureDefaultModel 事后再改一次
     * config.toml 才活过来。那一刀有两个代价：保存成功到补写落盘之间发消息就是
     * Authentication required；而且补写是我们自己原地改对方的 TOML，正是 agent_cli
     * 模块头明令不做的那件事。写对一次，好过写错再补。
     *
     * 为什么不无条件写：--default-model 是覆盖。已经配过一家、默认模型也选好了的人，
     * 再给第二家填个密钥，默认模型会被无声换掉。
     *
     * 读不到就当它已经有了：宁可这一次不带，也不要盖掉人自己选好的那个。
     */
    void store
      .loadDefaultModel(agentId)
      .catch(() => '')
      .then((existing) => {
        const seed = existing === null ? builtinProviderDefaultModelId(provider) : undefined

        let args: readonly string[]

        /*
         * 条件展开而不是传 undefined：exactOptionalPropertyTypes 下，可选属性收不了一个
         * 显式的 undefined。
         */
        try {
          args = agentProviderCatalogAddArgs({
            providerId: provider.id,
            ...(seed === undefined ? {} : { defaultModelId: seed }),
            ...(provider.baseUrl === '' ? {} : { baseUrl: provider.baseUrl }),
          })
        } catch (cause: unknown) {
          setBusy(false)
          setMessage(describeAgentCliFailure(cause, '这组参数没法安全地交给命令行。'))
          return
        }

        return store
          .execCli({
            agentId,
            args,
            secretVar: keyVar,
            secretValue: secret,
            catalogDocument: agentProviderCatalogDocument([provider]),
          })
          .then(
            (outcome) => {
              setBusy(false)

              if (outcome.status !== 0) {
                setMessage(describeAgentCliExit(outcome.status, outcome.stderr))
                return
              }

              setApiKey('')
              onSaved()

              /*
               * 到这里写入已经成功了。下面这一步回答的是另一个问题：那家认不认这把钥匙。
               *
               * 它在 onSaved 之后，而且刻意不挡任何东西 —— 模型清单该刷新就刷新，密钥该在
               * 配置里就在配置里。探测只改这张卡上那一行字。
               *
               * 之所以非做不可：在此之前，这张卡对「成功」的全部判据是 outcome.status 为 0，
               * 而 catalog add 从头到尾没有联系过厂商。填错一个字符照样是 0。
               */
              setVerifying(true)
              setMessage('已写入 agent 自己的配置，正在验证密钥…')

              void store.verifyProviderKey({ baseUrl: provider.baseUrl, secret }).then(
                (probe) => {
                  setVerifying(false)
                  setMessage(describeKeyVerdict(probe, provider.displayName))
                },
                () => {
                  /* 探测这条路自己坏了，同样不能推断密钥有问题。 */
                  setVerifying(false)
                  setMessage('已写入 agent 自己的配置。没能验证这把密钥。')
                },
              )
            },
            (cause: unknown) => {
              setBusy(false)
              setMessage(describeAgentCliFailure(cause, '写入失败，请重试。'))
            },
          )
      })
  }, [agentId, apiKey, onSaved, provider, registryKeyVar, store])

  return (
    <div aria-busy={busy} className="models-card">
      <div className="models-row">
        <div className="models-row__copy">
          <strong>{provider.displayName}</strong>
          <p>{provider.description}</p>
        </div>
      </div>

      <SubField
        label="API 密钥"
        onChange={editKey}
        placeholder={`输入 ${provider.displayName} API 密钥`}
        secret
        value={apiKey}
      />

      <div className="models-row models-row--field">
        <span className="models-row__name">密钥申请地址</span>

        <div className="models-row__control">
          <span className="models-row__meta">{provider.apiKeysUrl}</span>
        </div>
      </div>

      {/*
       * 接口地址与上一行同构：名字在左、值在右。此前它把值拼进标签里，而
       * baseUrl 可以是空 —— submit 里那句 provider.baseUrl === '' 就是证据 ——
       * 于是那种厂商这里显示的是「接口地址 」加一段空白。空就不画这一行。
       */}
      {provider.baseUrl === '' ? null : (
        <div className="models-row models-row--field">
          <span className="models-row__name">接口地址</span>

          <div className="models-row__control">
            <span className="models-row__meta">{provider.baseUrl}</span>
          </div>
        </div>
      )}

      <div className="models-row models-row--field">
        {/*
         * 回执与动作同一行：左边说发生了什么，右边是引发它的那个动作。
         *
         * 此前这两句话是卡片中段两段 .models-empty —— 一个叫「空状态」的类被拿
         * 来说「已写入」和错误原因，而且回执与按钮隔着三行。
         *
         * 这个区域常驻，不再随内容出现才挂载：live region 要先在场、再变内容，
         * 否则读屏不会播报 —— 按下保存之后什么也听不到，正是此前的行为。
         */}
        <span aria-live="polite" className="models-row__meta">
          {busy && waited ? '还在等 agent 回应，正在等它写完配置。' : message}
        </span>

        <div className="models-row__control">
          {busy || verifying ? <InlineSpinner /> : null}

          <Button
            disabled={busy || apiKey.trim().length === 0}
            onClick={submit}
            size="xs"
            type="button"
            variant="soft"
          >
            {busy ? '正在写入…' : '保存到 agent'}
          </Button>
        </div>
      </div>
    </div>
  )
}
