import type { PluginManifest } from '@poietica/editor-extensions'

export interface PluginVerifier {
  verify(
    packagePath: string,
  ): Promise<{ valid: boolean; manifest?: PluginManifest; error?: string }>
}
