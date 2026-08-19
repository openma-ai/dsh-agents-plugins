import type {
  MarketplaceCatalogObservation,
  MarketplaceCatalogProvider,
  MarketplacePluginSource,
} from './types.js'
import type { Context } from '@deepseek-ai/cordis'
import {
  parseGitRepositorySource,
  parseGitHubRepositorySource,
  parseMarketplaceRelativeDirectory,
  parsePluginEntry,
  requireIdentifier,
  requirePlugins,
  requireRecord,
  requireUniquePluginNames,
} from './validation.js'

export const CLAUDE_CODE_MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json'

/** Claude Code's documented marketplace catalog, normalized into bridge-owned source kinds. */
export const claudeCodeMarketplaceProvider: MarketplaceCatalogProvider = {
  name: 'claude-code-marketplace',
  probe(source): MarketplaceCatalogObservation | undefined {
    if (source.manifestPath !== CLAUDE_CODE_MARKETPLACE_MANIFEST) return undefined

    const manifest = requireRecord(source.manifest, 'marketplace')
    const plugins = requirePlugins(manifest).map((entry, index) =>
      parsePluginEntry(entry, index, parseClaudeCodeSource),
    )
    requireUniquePluginNames(plugins)
    return {
      name: requireIdentifier(manifest.name, 'marketplace.name'),
      manifestPath: source.manifestPath,
      plugins,
    }
  },
}

function parseClaudeCodeSource(value: unknown, field: string): MarketplacePluginSource {
  if (typeof value === 'string') return parseMarketplaceRelativeDirectory(value, field)
  const source = requireRecord(value, field)
  if (source.source === 'url' || source.source === 'git-subdir') {
    return parseGitRepositorySource(source, field, { allowUrlSubdirectory: true })
  }
  if (source.source === 'npm') {
    throw new TypeError(`${field}: npm marketplace sources are documented but not supported by this bridge`)
  }
  if (source.commit === undefined) return parseGitHubRepositorySource(source, field)
  if (typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/iu.test(source.commit)) {
    throw new TypeError(`${field}.commit must be a 40-character Git commit`)
  }
  // Anthropic's installed official catalog includes a provenance `commit`
  // beside the documented install pin `sha`; validate it, then retain `sha`
  // as the sole acquisition revision.
  const { commit: _commit, ...documentedSource } = source
  return parseGitHubRepositorySource(documentedSource, field)
}

export const name = 'plugin-bridge-marketplace-claude-code'
export const inject = ['pluginBridge']

/** Register only the Claude Code marketplace dialect on this Cordis row. */
export function apply(ctx: Context): void {
  ctx.pluginBridge.registerMarketplaceProvider(claudeCodeMarketplaceProvider)
}
