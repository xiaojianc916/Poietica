import { parseAcpAgentProfileSet } from '@poietica/agent-registry'
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
      return fromDto(await bridge.load())
    },

    async saveAgents({ agents, defaultAgentId }) {
      return fromDto(await bridge.saveAgents(agents, defaultAgentId))
    },

    async saveCatalog({ catalog, fetchedAt }) {
      return fromDto(await bridge.saveCatalog(catalog, fetchedAt))
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
