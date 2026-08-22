import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  MarketplaceRegistrationCandidate,
  MarketplaceRegistrationLocator,
  MarketplaceRegistrationLocatorObservation,
} from '../kernel.js'

export const name = 'plugin-bridge-discovery-claude-code-marketplaces'
export const inject = ['pluginBridge']

export interface Config {
  readonly registryPath?: string
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Observes Claude Code's explicit known_marketplaces.json checkout registry. */
export function createClaudeCodeMarketplaceRegistrationLocator(
  config: Config = {},
): MarketplaceRegistrationLocator {
  const registryPath = config.registryPath
    ?? join(homedir(), '.claude', 'plugins', 'known_marketplaces.json')
  return {
    name: 'claude-code-registered-marketplaces',
    async discover(): Promise<MarketplaceRegistrationLocatorObservation> {
      let registry: Record<string, unknown>
      try {
        if (!(await lstat(registryPath)).isFile()) {
          return {
            candidates: [],
            diagnostics: [`claude-code-registered-marketplaces: "${registryPath}" is not a regular file`],
          }
        }
        registry = objectRecord(JSON.parse(await readFile(registryPath, 'utf8'))) ?? {}
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { candidates: [] }
        return {
          candidates: [],
          diagnostics: [`claude-code-registered-marketplaces: cannot read "${registryPath}": ${String(error)}`],
        }
      }

      const candidates: MarketplaceRegistrationCandidate[] = []
      const diagnostics: string[] = []
      for (const marketplaceName of Object.keys(registry).sort()) {
        const entry = objectRecord(registry[marketplaceName])
        const location = entry?.installLocation
        if (typeof location !== 'string' || location.length === 0) {
          diagnostics.push(`claude-code-registered-marketplaces: ${marketplaceName} has no installLocation`)
          continue
        }
        try {
          if (!(await lstat(location)).isDirectory()) {
            diagnostics.push(`claude-code-registered-marketplaces: ${marketplaceName} installLocation is not a directory`)
            continue
          }
          candidates.push({
            key: encodeURIComponent(marketplaceName),
            name: marketplaceName,
            location: await realpath(location),
            sourceType: 'installed-checkout',
            manifestPath: '.claude-plugin/marketplace.json',
          })
        } catch (error: unknown) {
          diagnostics.push(`claude-code-registered-marketplaces: ${marketplaceName} cannot be inspected: ${String(error)}`)
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
  ctx.pluginBridge.registerMarketplaceRegistrationLocator(
    createClaudeCodeMarketplaceRegistrationLocator(config),
  )
}
