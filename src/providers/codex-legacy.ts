import type { Context } from '@deepseek-ai/cordis'
import type { PackageFormatProvider } from '../kernel.js'
import {
  declaredComponents,
  dedupeComponents,
  fixedComponent,
  manifestObject,
} from './legacy-utils.js'

const MANIFEST_PATH = '.codex-plugin/plugin.json'
const FORMAT = 'codex-legacy'

/** OpenAI Codex plugin layout rooted at `.codex-plugin/plugin.json`. */
export const codexLegacyProvider: PackageFormatProvider = {
  name: FORMAT,
  probe(source) {
    if (!source.has(MANIFEST_PATH)) return undefined
    const manifest = manifestObject(source.readJson(MANIFEST_PATH), FORMAT)
    const components = dedupeComponents([
      ...declaredComponents(source, MANIFEST_PATH, manifest, 'skills', 'skill', FORMAT),
      ...declaredComponents(source, MANIFEST_PATH, manifest, 'mcpServers', 'mcp-server', FORMAT),
      ...declaredComponents(source, MANIFEST_PATH, manifest, 'apps', 'app', FORMAT),
      ...manifest.hooks === undefined
        ? fixedComponent(source, 'hook', 'hooks/hooks.json')
        : declaredComponents(source, MANIFEST_PATH, manifest, 'hooks', 'hook', FORMAT),
    ])
    return {
      manifestPath: MANIFEST_PATH,
      manifest: Object.freeze({ ...manifest }),
      components,
    }
  },
}

export const name = 'plugin-bridge-format-codex-legacy'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerPackageFormatProvider(codexLegacyProvider)
}
