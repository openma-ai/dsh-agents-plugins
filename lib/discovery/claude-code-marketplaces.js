import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const name = 'plugin-bridge-discovery-claude-code-marketplaces';
export const inject = ['pluginBridge'];
function objectRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/** Observes Claude Code's explicit known_marketplaces.json checkout registry. */
export function createClaudeCodeMarketplaceRegistrationLocator(config = {}) {
    const registryPath = config.registryPath
        ?? join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');
    return {
        name: 'claude-code-registered-marketplaces',
        async discover() {
            let registry;
            try {
                if (!(await lstat(registryPath)).isFile()) {
                    return {
                        candidates: [],
                        diagnostics: [`claude-code-registered-marketplaces: "${registryPath}" is not a regular file`],
                    };
                }
                registry = objectRecord(JSON.parse(await readFile(registryPath, 'utf8'))) ?? {};
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return { candidates: [] };
                return {
                    candidates: [],
                    diagnostics: [`claude-code-registered-marketplaces: cannot read "${registryPath}": ${String(error)}`],
                };
            }
            const candidates = [];
            const diagnostics = [];
            for (const marketplaceName of Object.keys(registry).sort()) {
                const entry = objectRecord(registry[marketplaceName]);
                const location = entry?.installLocation;
                if (typeof location !== 'string' || location.length === 0) {
                    diagnostics.push(`claude-code-registered-marketplaces: ${marketplaceName} has no installLocation`);
                    continue;
                }
                try {
                    if (!(await lstat(location)).isDirectory()) {
                        diagnostics.push(`claude-code-registered-marketplaces: ${marketplaceName} installLocation is not a directory`);
                        continue;
                    }
                    candidates.push({
                        key: encodeURIComponent(marketplaceName),
                        name: marketplaceName,
                        location: await realpath(location),
                        sourceType: 'installed-checkout',
                        manifestPath: '.claude-plugin/marketplace.json',
                    });
                }
                catch (error) {
                    diagnostics.push(`claude-code-registered-marketplaces: ${marketplaceName} cannot be inspected: ${String(error)}`);
                }
            }
            return {
                candidates,
                ...diagnostics.length === 0 ? {} : { diagnostics },
            };
        },
    };
}
export function apply(ctx, config = {}) {
    ctx.pluginBridge.registerMarketplaceRegistrationLocator(createClaudeCodeMarketplaceRegistrationLocator(config));
}
//# sourceMappingURL=claude-code-marketplaces.js.map