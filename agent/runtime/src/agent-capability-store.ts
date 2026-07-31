import type {
  AgentCapabilityPort,
  SessionConfigChoice,
  SessionConfigControl,
} from '@poietica/agent-protocol'
import { useSyncExternalStore } from 'react'

/*
 * 「有哪些模型可选」属于这个 agent，不属于任何一条会话。
 *
 * 这张表此前是"学"来的：一条会话报回它的选择器，这里记下来、写进 localStorage，
 * 下次启动先摆上那一份。而两个写入口通向同一道闸 —— 原生侧的 agent_capabilities
 * 与 agent_open_thread 第一行都是 ensure_session，也就是先起进程、先握手，而握手
 * 要 agent 交出一个会话号。上游在开会话之前先查 default_model 可不可用
 * （hasUsableConfiguredDefaultModel 第一行：defaultModel 缺席就 return false）。
 *
 * 于是"看清单"依赖"已经从清单里选好一个"：一台刚配好密钥的机器没有缓存、开不了
 * 会话，这张表永远是空的，下面那个自动补齐也永远等不到候选。localStorage 那一份
 * 曾自称"离线兜底，不是任何东西的真相"，实际上它是全新机器上唯一能打破这个死锁的
 * 东西 —— 那不是兜底，那是替一条走不通的取数路径打掩护。
 *
 * 现在只有一个产地：agent 官方 CLI 的 provider list --json（见组合根的
 * desktopAgentModels）。一次子进程调用，不需要会话、不需要握手，读的就是 agent
 * 那份 config.toml —— 设置页一直走的是它。路通了，掩护也就没有存在的理由。
 *
 * 三件生命周期不同的事仍然分开：
 *
 *   · 有哪些模型：属于 agent 的配置文件。问一次，全进程共用。
 *   · 选中的那个：属于同一份配置的顶层 default_model，一处。
 *   · 某条会话此刻真在用哪个：属于那条会话，由 ThreadsStore 按 threadId 保管。
 *
 * 非模型的那些选择器（thought / mode）不在这里。它们是会话级的，没有会话的时候
 * 说不出真话；有会话时由 ThreadsStore.selectorsOf 交出来。
 */

/** ACP 里模型那一项的 id 是协议常量，不是我们起的名字。 */
const MODEL_CONTROL_ID = 'model'

const MODEL_CONTROL_LABEL = '模型'

const NO_CONTROLS: readonly SessionConfigControl[] = []

const NO_MODELS: readonly SessionConfigChoice[] = []

/* 这个 agent 配了哪些模型。只在内存里：权威是它自己的配置文件。 */
let models: readonly SessionConfigChoice[] = NO_MODELS

/*
 * 模型那一项选中什么。
 *
 * 它的家是 agent 配置里的顶层 default_model，这里只是那个值的一份内存镜像：由
 * installAgentDefaultModelSource 问回来，由选择器拨动时更新。不落 localStorage
 * —— 落了就又是第二个家。
 */
let chosenModel: string | null = null

/*
 * 画出去的那张表是投影：清单来自上面那份，选中值来自下面那份。
 *
 * 只在 publish 时算一次，不在每次读取时算 —— useSyncExternalStore 要求快照引用
 * 稳定，每次现算会让它认定"状态一直在变"而无限重渲染。
 */
function project(): readonly SessionConfigControl[] {
  if (models.length === 0) {
    return NO_CONTROLS
  }

  return [
    {
      id: MODEL_CONTROL_ID,
      label: MODEL_CONTROL_LABEL,
      purpose: 'model',
      current: chosenModel ?? models[0]?.value ?? '',
      choices: models,
    },
  ]
}

let snapshot: readonly SessionConfigControl[] = NO_CONTROLS

const listeners = new Set<() => void>()

function publish(): void {
  snapshot = project()

  for (const listener of listeners) {
    listener()
  }
}

/**
 * 人拨动了模型选择器，或者刚从配置里读到 default_model。
 *
 * 这是一次乐观更新，不是一份偏好。真值在 agent 自己的 config.toml 里，写它的是
 * 调用方；agent watch 着那个文件，但 watcher 有延迟，所以这里不等它、也不回读，
 * 先把屏幕上那一格改对。
 */
export function setAgentDefaultModel(alias: string | null): void {
  if (chosenModel === alias) {
    return
  }

  chosenModel = alias
  publish()
}

/**
 * 此刻选中的是哪个模型。
 *
 * 会话那一侧要拿它把自己对齐过来：一条旧对话记着别的模型是它自己的历史，不是
 * "现在选中什么"的答案。这个函数就是那个答案唯一的产地。
 */
export function agentDefaultModel(): string | null {
  return chosenModel
}

/*
 * 一个模型都没选中时，替他挑一个。
 *
 * 这是「配好了密钥、模型也列出来了，一发消息却说 Authentication required」的根治：
 * 上游 hasUsableConfiguredDefaultModel 第一行就是 config.defaultModel === undefined
 * 时 return false，于是配置文件里的 api_key 整条不算数。
 *
 * 它此前够不着自己要治的那个病：候选表要等一条会话报回来，而开会话正是被这个病
 * 挡住的那件事。清单改由 CLI 直接读之后，这一路第一次真的能在"还开不了会话"的
 * 时刻跑起来。
 *
 * 挑第一个是稳定的：快照在 agent-provider-state 里按 provider id 排过序，同一份
 * 配置每次挑到的是同一个。挑出来的只是个起点，不是偏好 —— 人拨一下它就变了。
 *
 * 「配置里那个别名已经死了」也走这一路：原生侧读回 default_model 时用的是闸门自己
 * 的判据，指不到东西的别名读回来就是 null。
 */
function ensureDefaultModel(): void {
  const save = defaultSource?.save

  if (!defaultKnown || chosenModel !== null || save === undefined) {
    return
  }

  const first = models[0]?.value

  if (first === undefined) {
    return
  }

  setAgentDefaultModel(first)

  void save(first).catch(() => {
    /* 没写进去就当没挑过，而不是让屏幕显示一个文件里没有的值。 */
    setAgentDefaultModel(null)
  })
}

/*
 * 清单从哪里来，以及什么时候去问。
 *
 * 端口在接线时装上，装上本身不问：真正那次读取要等第一个订阅者出现 —— 也就是
 * 屏幕上真的有一个选择器要画的时候。一个从没打开过助手的启动不为此付钱。
 *
 * 失败之后把 asked 放回去：下一次有人要看选择器时会再问一次，而不是让一次开机时
 * 的失败永久变成一张空表。
 */
let source: AgentCapabilityPort | undefined

let asked = false

let report: ((cause: unknown) => void) | undefined

/*
 * default_model 从哪里读、往哪里写。
 *
 * 这个包不认识 AgentConfigStore，也不该认识 —— 它只要两个函数：问一次，和写一次。
 */
interface DefaultModelSource {
  readonly load: () => Promise<string | null>
  readonly save: (alias: string) => Promise<unknown>
}

let defaultSource: DefaultModelSource | undefined

/*
 * 已经问过的那一份来源。
 *
 * 记的不是「问过没有」，是「问的是哪一份」：来源按 agent 接进来，换一家会重新
 * install，一个布尔会把新那家永远挡在门外。
 */
let askedFor: DefaultModelSource | undefined

/*
 * 那一次读取回来过没有。
 *
 * 不能拿 chosenModel === null 当这个问题的答案：还没问到的时候它也是 null，而自动
 * 补齐正是靠这个判断决定要不要写入 —— 分不清「确实没有」与「还不知道」，就会拿第一个
 * 候选盖掉人原本配好的那个。只在读取成功时置位。
 */
let defaultKnown = false

function loadDefaultOnce(): void {
  const asking = defaultSource

  if (asking === undefined || askedFor === asking) {
    return
  }

  askedFor = asking
  asking
    .load()
    .then((alias) => {
      /* 问的时候还是这一家，答回来已经换了人：这个答案不是给现在这一格的。 */
      if (defaultSource !== asking) {
        return
      }

      defaultKnown = true
      setAgentDefaultModel(alias)
      ensureDefaultModel()
    })
    .catch(() => {
      if (askedFor === asking) {
        askedFor = undefined
      }
    })
}

/** 接线时交进来：怎么读、怎么写 agent 配置里的 default_model。 */
export function installAgentDefaultModelSource(source: DefaultModelSource): void {
  if (defaultSource === source) {
    return
  }

  /*
   * 换了一家 agent。上一家的选中值和「已经问到了」两件事都不再成立 —— 留着它们，
   * 屏幕会用上一家的别名冒充这一家的选中项，而自动补齐会以为无事可做。
   */
  defaultSource = source
  defaultKnown = false
  setAgentDefaultModel(null)
  loadDefaultOnce()
}

/**
 * 接线时装上取清单的那一路。
 *
 * 端口的身份就是「换没换一家」的判据，所以组合根按 agentId 记住那个对象；同一家
 * 反复装上是幂等的，换一家则连清单一起归零。此前这里无条件覆盖 source 而不动
 * asked，于是换 agent 之后屏幕上挂着的还是上一家的模型。
 */
export function installAgentCapabilityPort(
  port: AgentCapabilityPort,
  onFailure?: (cause: unknown) => void,
): void {
  report = onFailure

  if (source === port) {
    return
  }

  source = port
  asked = false
  models = NO_MODELS
  publish()

  /* 已经有人在看选择器了才立刻问；没有就仍旧等第一个订阅者。 */
  if (listeners.size > 0) {
    loadOnce()
  }
}

function loadOnce(): void {
  const port = source

  if (asked || port === undefined) {
    return
  }

  asked = true
  port
    .read()
    .then((offered) => {
      /* 问的时候还是这一家，答回来已经换了人。 */
      if (source !== port) {
        return
      }

      models = offered
      publish()

      /* 候选可能是这一刻才第一次到达的：那正是"该不该替他挑一个"重新有答案的时刻。 */
      ensureDefaultModel()
    })
    .catch((cause: unknown) => {
      if (source !== port) {
        return
      }

      asked = false
      report?.(cause)
    })
}

/**
 * 只听，不问。
 *
 * 与 subscribeAgentControls 的区别只有一处，但那一处要紧：这个不调 loadOnce。
 * 挂一个监听器不该把 agent 的 CLI 叫起来 —— 会话那一侧在应用启动时就要听着默认
 * 模型的变化，而那时屏幕上可能一个选择器都还没有。
 */
export function observeAgentControls(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function subscribeAgentControls(listener: () => void): () => void {
  listeners.add(listener)
  loadOnce()
  loadDefaultOnce()

  return () => {
    listeners.delete(listener)
  }
}

function readAgentControls(): readonly SessionConfigControl[] {
  return snapshot
}

/** 入口那一格（以及任何还没拿到会话表的那一格）要画的选择器。 */
export function useAgentControls(): readonly SessionConfigControl[] {
  return useSyncExternalStore(subscribeAgentControls, readAgentControls)
}
