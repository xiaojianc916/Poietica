import {
  builtinAcpAgentProfiles,
  defaultAcpAgent,
  parseAcpAgentProfileSet,
} from '@poietica/agent-registry'
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

      /*
       * 磁盘上一条档案都没有 —— 那就把内置档案真的写下去，而不是在内存里假装有。
       *
       * parseAcpAgentProfileSet 的回退只活在这一次渲染里：渲染层于是看得见 kimi，
       * 而 agents.json 仍然是空的，原生侧的 agent_program 与 launch_env 读的是那个
       * 空文件。两个真相里只有一个能起进程，另一个只能让界面报错。
       *
       * 判据是 dto.agents.length === 0，而不是「解析后为空」：一份被手改坏的档案也
       * 会解析成空，覆盖过去等于替用户删文件。
       */
      if (dto.agents.length === 0) {
        return fromDto(await bridge.saveAgents(builtinAcpAgentProfiles(), defaultAcpAgent().id))
      }

      return fromDto(dto)
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
