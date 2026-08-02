import type { AgentCapabilityPort, SessionConfigControl } from '@poietica/acp'
import { useSyncExternalStore } from 'react'

/*
 * 这个 agent 提供哪些可调项，以及每一项此刻选中什么。
 *
 * 三件生命周期不同的事，分三处：
 *
 *   · 提供哪些：属于 agent 的配置与握手。问一次，全进程共用（产地见组合根的
 *     desktopAgentCapabilities）。
 *   · 选中哪个：属于人，不属于任何一条会话 —— 入口那一格没有会话，照样要选得动。
 *   · 某条会话此刻真在用哪个：属于那条会话，由 ThreadsStore 按 threadId 保管，并
 *     由它把会话对齐到这里选中的值。
 *
 * 模型不特殊，只多一件事：它有家，就是 agent 配置里的顶层 default_model。其余的
 * 没有落盘的地方，也就不落 —— 落了就是第二个家。
 */

/** 模型那一格由组合根合成，id 与 purpose 都是这个字面量。 */
const MODEL = 'model'

const NO_CONTROLS: readonly SessionConfigControl[] = []

/* 这个 agent 提供的整张表。只在内存里：权威是它自己的配置。 */
let offered: readonly SessionConfigControl[] = NO_CONTROLS

/* 每一项选中什么，按 controlId 记。 */
const chosen = new Map<string, string>()

/*
 * 画出去的那张表是投影：清单来自 offered，选中值来自 chosen。
 *
 * 只在 publish 时算一次，不在每次读取时算 —— useSyncExternalStore 要求快照引用
 * 稳定，每次现算会让它认定"状态一直在变"而无限重渲染。
 */
function project(): readonly SessionConfigControl[] {
  if (offered.length === 0) {
    return NO_CONTROLS
  }

  return offered.map((control) => {
    const wanted = chosen.get(control.id)

    if (wanted === undefined || wanted === control.current) {
      return control
    }

    return { ...control, current: wanted }
  })
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
 * 人拨动了一个选择器，或者刚从配置里读到 default_model。
 *
 * 这是一次乐观更新，不是一份偏好：真正的下发由 ThreadsStore 对每条会话统一去做
 * （observeAgentControls → #realign → #align）。这里只回答"现在要的是哪个"。
 *
 * 传 null 就是撤回这一项的选择。
 */
export function chooseAgentControl(controlId: string, value: string | null): void {
  if ((chosen.get(controlId) ?? null) === value) {
    return
  }

  if (value === null) {
    chosen.delete(controlId)
  } else {
    chosen.set(controlId, value)
  }

  publish()
}

/**
 * 这一项此刻选中的是哪个值。
 *
 * 会话那一侧要拿它把自己对齐过来：一条旧对话记着别的值是它自己的历史，不是
 * "现在选中什么"的答案。这个函数就是那个答案唯一的产地。
 */
export function agentChosen(controlId: string): string | undefined {
  return chosen.get(controlId)
}

/*
 * 一个模型都没选中时，替他挑一个。
 *
 * 这是「配好了密钥、模型也列出来了，一发消息却说 Authentication required」的根治：
 * 上游 hasUsableConfiguredDefaultModel 第一行就是 defaultModel 缺席时 return false，
 * 于是配置文件里的 api_key 整条不算数。
 *
 * 挑第一个是稳定的：快照在 provider-state 里按 provider id 排过序。挑出来的
 * 只是个起点，不是偏好 —— 人拨一下它就变了。
 */
function ensureDefaultModel(): void {
  const save = defaultSource?.save
  const model = offered.find((control) => control.purpose === MODEL)

  if (!defaultKnown || save === undefined || model === undefined) {
    return
  }

  if (chosen.get(model.id) !== undefined) {
    return
  }

  const first = model.choices[0]?.value

  if (first === undefined) {
    return
  }

  chooseAgentControl(model.id, first)

  void save(first).then(
    () => {
      /*
       * 配置里第一次有了可用的 default_model：锚会话到这一刻才开得起来，而模式与
       * 推理档位正是从那里来的。重问一次，不要让它们等到下次启动。
       */
      asked = false
      loadOnce()
    },
    () => {
      /* 没写进去就当没挑过，而不是让屏幕显示一个文件里没有的值。 */
      chooseAgentControl(model.id, null)
    },
  )
}

/*
 * 清单从哪里来，以及什么时候去问。
 *
 * 端口在接线时装上，装上本身不问：真正那次读取要等第一个订阅者出现 —— 也就是
 * 屏幕上真的有一个选择器要画的时候。一个从没打开过助手的启动不为此付钱。
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
 * 不能拿"没有选中值"当这个问题的答案：还没问到的时候也是没有，而自动补齐正是靠
 * 这个判断决定要不要写入 —— 分不清「确实没有」与「还不知道」，就会拿第一个候选
 * 盖掉人原本配好的那个。只在读取成功时置位。
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
      chooseAgentControl(MODEL, alias)
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
  chooseAgentControl(MODEL, null)
  loadDefaultOnce()
}

/**
 * 接线时装上取整张表的那一路。
 *
 * 端口的身份就是「换没换一家」的判据，所以组合根按 agentId 记住那个对象；同一家
 * 反复装上是幂等的，换一家则连表一起归零。
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
  offered = NO_CONTROLS
  publish()

  /* 已经有人在看选择器了才立刻问；没有就仍旧等第一个订阅者。 */
  if (listeners.size > 0) {
    loadOnce()
  }
}

/**
 * agent 自己的配置被改过了：这张表不再作数，重问。
 *
 * 为什么需要一个显式入口：asked 只在「换了一家 agent」「自动补默认模型写盘成功」
 * 「这一次读取失败」三种情形下放回 false。首次启动一个 provider 都没配时，
 * readModels 得到空表，ensureDefaultModel 因为 offered 里根本没有模型那一格而
 * 提前 return —— 三条路一条都没走到，asked 就此永远为真。人在设置页把 provider
 * 导进去之后，进程里没有任何东西能让它再问一次。
 *
 * 不清空 offered：重问期间旧表继续画。它仍是 agent 片刻前的真实配置，把工具条
 * 先闪成空的换不到任何正确性（stale-while-revalidate，与设置页那份同一套做法）。
 *
 * default_model 一起重读，这一条不能省。刚才那次导入很可能已经把它写进配置了
 * （runImport 的 defaultModelOwner 特意挑了一家带上 --default-model）。若只放回
 * asked，能力表回来时 chosen 里还没有模型，ensureDefaultModel 就会拿 choices[0]
 * 写盘 —— 把人刚导进去的那个默认模型盖掉。
 */
export function refreshAgentCapabilities(): void {
  asked = false
  askedFor = undefined
  defaultKnown = false

  /* 没人在看就不问：下一个订阅者出现时 subscribeAgentControls 自会补上。 */
  if (listeners.size > 0) {
    loadOnce()
    loadDefaultOnce()
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
    .then((table) => {
      /* 问的时候还是这一家，答回来已经换了人。 */
      if (source !== port) {
        return
      }

      offered = table
      publish()

      /* 候选可能是这一刻才第一次到达的：那正是"该不该替他挑一个"重新有答案的时刻。 */
      ensureDefaultModel()
    })
    .catch((cause: unknown) => {
      if (source !== port) {
        return
      }

      /* 失败之后放回去：下一次有人要看选择器时再问，而不是永久一张空表。 */
      asked = false
      report?.(cause)
    })
}

/**
 * 只听，不问。
 *
 * 与 subscribeAgentControls 的区别只有一处，但那一处要紧：这个不调 loadOnce。
 * 挂一个监听器不该把 agent 叫起来 —— 会话那一侧在应用启动时就要听着选中值的变化，
 * 而那时屏幕上可能一个选择器都还没有。
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
