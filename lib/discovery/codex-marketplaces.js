import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
export const name = 'plugin-bridge-discovery-codex-marketplaces';
export const inject = ['pluginBridge'];
function objectRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/** Observes only Codex's explicit `[marketplaces.<name>]` config registrations. */
export function createCodexMarketplaceRegistrationLocator(config = {}) {
    const configPath = config.configPath ?? join(homedir(), '.codex', 'config.toml');
    return {
        name: 'codex-registered-marketplaces',
        async discover() {
            let marketplaces;
            try {
                if (!(await lstat(configPath)).isFile()) {
                    return {
                        candidates: [],
                        diagnostics: [`codex-registered-marketplaces: "${configPath}" is not a regular file`],
                    };
                }
                const document = objectRecord(parse(await readFile(configPath, 'utf8')));
                marketplaces = objectRecord(document?.marketplaces) ?? {};
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return { candidates: [] };
                return {
                    candidates: [],
                    diagnostics: [`codex-registered-marketplaces: cannot read "${configPath}": ${String(error)}`],
                };
            }
            const candidates = [];
            const diagnostics = [];
            for (const marketplaceName of Object.keys(marketplaces).sort()) {
                const entry = objectRecord(marketplaces[marketplaceName]);
                const sourceType = entry?.source_type;
                const source = entry?.source;
                if (entry === undefined || typeof source !== 'string' || source.length === 0) {
                    diagnostics.push(`codex-registered-marketplaces: ${marketplaceName} has no string source`);
                    continue;
                }
                if (sourceType === 'local') {
                    try {
                        if (!(await lstat(source)).isDirectory()) {
                            diagnostics.push(`codex-registered-marketplaces: ${marketplaceName} local source is not a directory`);
                            continue;
                        }
                        candidates.push({
                            key: encodeURIComponent(marketplaceName),
                            name: marketplaceName,
                            location: await realpath(source),
                            sourceType: 'local',
                        });
                    }
                    catch (error) {
                        diagnostics.push(`codex-registered-marketplaces: ${marketplaceName} local source cannot be inspected: ${String(error)}`);
                    }
                    continue;
                }
                if (sourceType === 'git') {
                    const revision = typeof entry.ref === 'string' && entry.ref.length > 0 ? entry.ref : undefined;
                    candidates.push({
                        key: encodeURIComponent(marketplaceName),
                        name: marketplaceName,
                        location: source,
                        sourceType: 'git',
                        ...revision === undefined ? {} : { revision },
                    });
                    continue;
                }
                diagnostics.push(`codex-registered-marketplaces: ${marketplaceName} uses unsupported source_type "${String(sourceType)}"`);
            }
            return {
                candidates,
                ...diagnostics.length === 0 ? {} : { diagnostics },
            };
        },
    };
}
export function apply(ctx, config = {}) {
    ctx.pluginBridge.registerMarketplaceRegistrationLocator(createCodexMarketplaceRegistrationLocator(config));
}
//# sourceMappingURL=codex-marketplaces.js.map