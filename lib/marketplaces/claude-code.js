import { parseGitHubRepositorySource, parseMarketplaceRelativeDirectory, parsePluginEntry, requireIdentifier, requirePlugins, requireRecord, requireUniquePluginNames, } from './validation.js';
export const CLAUDE_CODE_MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';
/** Claude Code's documented marketplace catalog, normalized into bridge-owned source kinds. */
export const claudeCodeMarketplaceProvider = {
    name: 'claude-code-marketplace',
    probe(source) {
        if (source.manifestPath !== CLAUDE_CODE_MARKETPLACE_MANIFEST)
            return undefined;
        const manifest = requireRecord(source.manifest, 'marketplace');
        const plugins = requirePlugins(manifest).map((entry, index) => parsePluginEntry(entry, index, parseClaudeCodeSource));
        requireUniquePluginNames(plugins);
        return {
            name: requireIdentifier(manifest.name, 'marketplace.name'),
            manifestPath: source.manifestPath,
            plugins,
        };
    },
};
function parseClaudeCodeSource(value, field) {
    if (typeof value === 'string')
        return parseMarketplaceRelativeDirectory(value, field);
    return parseGitHubRepositorySource(requireRecord(value, field), field);
}
export const name = 'plugin-bridge-marketplace-claude-code';
export const inject = ['pluginBridge'];
/** Register only the Claude Code marketplace dialect on this Cordis row. */
export function apply(ctx) {
    ctx.pluginBridge.registerMarketplaceProvider(claudeCodeMarketplaceProvider);
}
//# sourceMappingURL=claude-code.js.map