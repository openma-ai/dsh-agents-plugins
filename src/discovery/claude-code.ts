import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  InstalledPluginCandidate,
  InstalledPluginLocator,
  InstalledPluginLocatorObservation,
} from '../kernel.js'

const MANIFEST_PATH = '.claude-plugin/plugin.json'

export const name = 'plugin-bridge-discovery-claude-code'
export const inject = ['pluginBridge']

export interface Config {
  /** Override for tests or a non-default Claude configuration directory. */
  readonly registryPath?: string
}

function manifestName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = (value as Record<string, unknown>).name
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function keySegment(value: string): string {
  return encodeURIComponent(value).replace(/%40/giu, '@')
}

/** Reads Claude Code's explicit installed_plugins.json registry without scanning its marketplaces. */
export function createClaudeCodeInstalledPluginLocator(config: Config = {}): InstalledPluginLocator {
  const registryPath = config.registryPath ?? join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  return {
    name: 'claude-code-installed',
    async discover(): Promise<InstalledPluginLocatorObservation> {
      let registry: Record<string, unknown>
      try {
        if (!(await lstat(registryPath)).isFile()) {
          return {
            candidates: [],
            diagnostics: [`claude-code-installed: "${registryPath}" is not a regular file`],
          }
        }
        registry = objectRecord(JSON.parse(await readFile(registryPath, 'utf8'))) ?? {}
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { candidates: [] }
        return {
          candidates: [],
          diagnostics: [`claude-code-installed: cannot read "${registryPath}": ${String(error)}`],
        }
      }
      const plugins = objectRecord(registry.plugins)
      if (plugins === undefined) {
        return {
          candidates: [],
          diagnostics: ['claude-code-installed: installed_plugins.json has no object-valued "plugins" field'],
        }
      }

      const candidates: InstalledPluginCandidate[] = []
      const diagnostics: string[] = []
      const keys = new Set<string>()
      for (const pluginId of Object.keys(plugins).sort()) {
        const entries = plugins[pluginId]
        if (!Array.isArray(entries)) {
          diagnostics.push(`claude-code-installed: ${pluginId} has a non-array registry entry`)
          continue
        }
        const separator = pluginId.lastIndexOf('@')
        const marketplace = separator > 0 ? pluginId.slice(separator + 1) : undefined
        for (const [index, unknownEntry] of entries.entries()) {
          const entry = objectRecord(unknownEntry)
          const installPath = entry?.installPath
          if (entry === undefined || typeof installPath !== 'string' || installPath.length === 0) {
            diagnostics.push(`claude-code-installed: ${pluginId}[${index}] has no installPath`)
            continue
          }
          const root = isAbsolute(installPath) ? installPath : resolve(dirname(registryPath), installPath)
          try {
            if (!(await lstat(root)).isDirectory()) {
              diagnostics.push(`claude-code-installed: ${pluginId}[${index}] installPath is not a directory`)
              continue
            }
            const manifestPath = join(root, MANIFEST_PATH)
            if (!(await lstat(manifestPath)).isFile()) {
              diagnostics.push(`claude-code-installed: ${pluginId}[${index}] has no regular Claude plugin manifest`)
              continue
            }
            const discoveredName = manifestName(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown)
            if (discoveredName === undefined) {
              diagnostics.push(`claude-code-installed: ${pluginId}[${index}] has an invalid plugin manifest name`)
              continue
            }
            const scope = typeof entry.scope === 'string' && entry.scope.length > 0 ? entry.scope : undefined
            const baseKey = `${keySegment(pluginId)}#${keySegment(scope ?? String(index))}`
            const key = keys.has(baseKey) ? `${baseKey}~${index}` : baseKey
            keys.add(key)
            const version = typeof entry.version === 'string' && entry.version.length > 0
              ? entry.version
              : undefined
            candidates.push({
              key,
              name: discoveredName,
              root: await realpath(root),
              evidence: 'installed-registry',
              ...version === undefined ? {} : { version },
              ...marketplace === undefined ? {} : { marketplace },
              ...scope === undefined ? {} : { scope },
            })
          } catch (error: unknown) {
            diagnostics.push(`claude-code-installed: ${pluginId}[${index}] cannot be inspected: ${String(error)}`)
          }
        }
      }
      return {
        candidates,
        ...diagnostics.length === 0 ? {} : { diagnostics },
      }
    },
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  ctx.pluginBridge.registerInstalledPluginLocator(createClaudeCodeInstalledPluginLocator(config))
}
