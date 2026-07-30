import { parseAcpAgentProfileSet, reconcileAcpAgentProfiles } from '@poietica/agent-registry'
import type { AgentConfigSnapshot, AgentConfigStore } from '@poietica/features-settings'
import {
  type AgentConfigSnapshot as AgentConfigSnapshotDto,
  createAgentConfigBridge,
} from '@poietica/platforms-desktop-ipc'

/*
 * agent 接入配置在桌面端的存储。
 *
 * 边界上有一处真实的翻译：Rust 侧把 agents 当不透明对象原样存取，生成出来是
 * unknown[]，而端口说的是 AcpAgentProfile[]。校验只能落在这里 —— agents.json
 * 可以被手改，一个被改坏的档案不应该变成一次任意命令执行。
 *
 * parseAcpAgentProfileSet 是容错的：坏条目被丢弃并记一条 issue，不会让整份配置
 * 解析失败。它产生的 issues 与 Rust 侧报回的 issues 合并后一起交给界面，因为两者
 * 都是「配置里有东西没能用上」，没有理由只显示其中一半。
 */
export function createDesktopAgentConfigStore(): AgentConfigStore {
  const bridge = createAgentConfigBridge()

  return {
    async load() {
      const dto = await bridge.load()
      const parsed = parseAcpAgentProfileSet({
        profiles: dto.agents,
        defaultProfileId: dto.defaultAgentId,
      })
      const reconciled = reconcileAcpAgentProfiles(parsed.value.profiles)

      /*
       * 内置档案的身份由二进制拥有，agents.json 只是它的一份物化 —— 所以每次读都重新
       * 物化。上一版只在文件为空时写一次，那份拷贝因此停在用户第一次启动的那个版本：
       * 后来加进档案的 registryKeyVar 到不了磁盘，设置页就说这个 agent 没有声明该往
       * 哪个环境变量注入密钥。首次落盘不再是一条特例分支，它就是「空名单的物化结果与
       * 磁盘不一致」这同一件事。
       *
       * 只有在没有任何条目被丢弃时才写回：一份被手改坏的档案解析后会少条目，写回去等于
       * 替用户删文件。这时物化只活在内存里（界面照样能用），并把 issue 照实说出去。
       * 文件本来就空则不存在这个风险。
       */
      const writable = dto.agents.length === 0 || parsed.issues.length === 0

      if (reconciled.changed && writable) {
        return fromDto(await bridge.saveAgents(reconciled.profiles, parsed.value.defaultProfileId))
      }

      return {
        agents: reconciled.profiles,
        defaultAgentId: parsed.value.defaultProfileId,
        legacyProviders: dto.legacyProviders,
        issues: [...dto.issues, ...parsed.issues],
      }
    },

    async saveAgents({ agents, defaultAgentId }) {
      return fromDto(await bridge.saveAgents(agents, defaultAgentId))
    },

    async clearLegacyProviders() {
      return fromDto(await bridge.clearLegacyProviders())
    },

    /* 请求与结果两侧同名同类型，没有可翻译的东西，翻一遍只会多一个出错的地方。 */
    execCli(invocation) {
      return bridge.execCli(invocation)
    },
  }
}

function fromDto(dto: AgentConfigSnapshotDto): AgentConfigSnapshot {
  const parsed = parseAcpAgentProfileSet({
    profiles: dto.agents,
    defaultProfileId: dto.defaultAgentId,
  })

  return {
    agents: parsed.value.profiles,
    defaultAgentId: parsed.value.defaultProfileId,
    legacyProviders: dto.legacyProviders,
    issues: [...dto.issues, ...parsed.issues],
  }
}
