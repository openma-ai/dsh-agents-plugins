import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
const MANIFEST_PATH = '.codex-plugin/plugin.json';
export const name = 'plugin-bridge-discovery-codex';
export const inject = ['pluginBridge'];
function compareCodePoints(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function keySegment(value) {
    return encodeURIComponent(value);
}
async function directoryNames(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort(compareCodePoints);
}
function manifestName(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const candidate = value.name;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined;
}
function objectRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/**
 * Observes Codex's versioned plugin cache. Codex does not expose a local
 * installed-plugin registry here, so every result is explicitly cache evidence.
 */
export function createCodexInstalledPluginLocator(config = {}) {
    const cacheDir = config.cacheDir ?? join(homedir(), '.codex', 'plugins', 'cache');
    const configPath = config.configPath ?? join(homedir(), '.codex', 'config.toml');
    return {
        name: 'codex-local-cache',
        async discover() {
            const candidates = [];
            const diagnostics = [];
            const configured = new Map();
            try {
                if (!(await lstat(configPath)).isFile()) {
                    return { candidates, diagnostics: [`codex-local-cache: "${configPath}" is not a regular file`] };
                }
                const document = objectRecord(parse(await readFile(configPath, 'utf8')));
                const plugins = objectRecord(document?.plugins);
                if (plugins === undefined)
                    return { candidates };
                for (const pluginId of Object.keys(plugins).sort(compareCodePoints)) {
                    const entry = objectRecord(plugins[pluginId]);
                    if (entry === undefined) {
                        diagnostics.push(`codex-local-cache: config entry "${pluginId}" is not a table`);
                        continue;
                    }
                    configured.set(pluginId, typeof entry.enabled === 'boolean' ? entry.enabled : undefined);
                }
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return { candidates };
                return {
                    candidates,
                    diagnostics: [`codex-local-cache: cannot read plugin registrations from "${configPath}": ${String(error)}`],
                };
            }
            let cacheRoot;
            try {
                if (!(await lstat(cacheDir)).isDirectory()) {
                    return { candidates, diagnostics: [`codex-local-cache: "${cacheDir}" is not a directory`] };
                }
                cacheRoot = await realpath(cacheDir);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return { candidates };
                return { candidates, diagnostics: [`codex-local-cache: cannot inspect "${cacheDir}": ${String(error)}`] };
            }
            for (const marketplace of await directoryNames(cacheRoot)) {
                const marketplaceRoot = join(cacheRoot, marketplace);
                for (const plugin of await directoryNames(marketplaceRoot)) {
                    const enabled = configured.get(`${plugin}@${marketplace}`);
                    if (!configured.has(`${plugin}@${marketplace}`))
                        continue;
                    const pluginRoot = join(marketplaceRoot, plugin);
                    for (const version of await directoryNames(pluginRoot)) {
                        const root = join(pluginRoot, version);
                        const relative = `${marketplace}/${plugin}/${version}`;
                        const manifestPath = join(root, MANIFEST_PATH);
                        try {
                            if (!(await lstat(manifestPath)).isFile()) {
                                diagnostics.push(`codex-local-cache: ${relative} has no regular Codex plugin manifest`);
                                continue;
                            }
                            const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
                            const discoveredName = manifestName(manifest);
                            if (discoveredName === undefined) {
                                diagnostics.push(`codex-local-cache: ${relative} has an invalid plugin manifest name`);
                                continue;
                            }
                            candidates.push({
                                key: [marketplace, plugin, version].map(keySegment).join('/'),
                                name: discoveredName,
                                root: await realpath(root),
                                evidence: 'plugin-cache',
                                version,
                                marketplace,
                                ...enabled === undefined ? {} : { enabled },
                            });
                        }
                        catch (error) {
                            if (error.code === 'ENOENT')
                                continue;
                            diagnostics.push(`codex-local-cache: ${relative} has an invalid plugin manifest: ${String(error)}`);
                        }
                    }
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
    ctx.pluginBridge.registerInstalledPluginLocator(createCodexInstalledPluginLocator(config));
}
//# sourceMappingURL=codex.js.map