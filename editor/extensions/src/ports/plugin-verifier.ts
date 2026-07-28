import type { PluginManifest } from '@poietica/agent-timeline'

export interface PluginVerifier {
  verify(
    packagePath: string,
  ): Promise<{ valid: boolean; manifest?: PluginManifest; error?: string }>
}
