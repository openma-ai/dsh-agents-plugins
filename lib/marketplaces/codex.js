import { parseMarketplaceRelativeDirectory, parsePluginEntry, requireIdentifier, requirePlugins, requireRecord, requireUniquePluginNames, } from './validation.js';
export const CODEX_MARKETPLACE_MANIFEST = '.agents/plugins/marketplace.json';
export const CODEX_LEGACY_MARKETPLACE_MANIFEST = 'marketplace.json';
/**
 * Codex's observed local catalog shape.
 *
 * No public remote marketplace wire format is assumed here: additional source
 * kinds must be introduced from published documentation or a real fixture.
 */
export const codexMarketplaceProvider = {
    name: 'codex-marketplace',
    probe(source) {
        if (source.manifestPath !== CODEX_MARKETPLACE_MANIFEST
            && source.manifestPath !== CODEX_LEGACY_MARKETPLACE_MANIFEST)
            return undefined;
        const manifest = requireRecord(source.manifest, 'marketplace');
        const plugins = requirePlugins(manifest).map((entry, index) => parsePluginEntry(entry, index, parseCodexSource));
        requireUniquePluginNames(plugins);
        return {
            name: requireIdentifier(manifest.name, 'marketplace.name'),
            manifestPath: source.manifestPath,
            plugins,
        };
    },
};
function parseCodexSource(value, field) {
    if (typeof value === 'string')
        return parseMarketplaceRelativeDirectory(value, field);
    const source = requireRecord(value, field);
    if (source.source === 'npm') {
        throw new TypeError(`${field}: npm marketplace sources are documented but not supported by this bridge`);
    }
    if (source.source === 'url' || source.source === 'git-subdir') {
        return parseCodexGitSource(source, field);
    }
    const unsupportedKey = Object.keys(source).find(key => key !== 'source' && key !== 'path');
    if (unsupportedKey !== undefined)
        throw new TypeError(`${field}.${unsupportedKey} is not supported`);
    if (source.source !== 'local')
        throw new TypeError(`${field}.source must be "local"`);
    return parseMarketplaceRelativeDirectory(source.path, `${field}.path`);
}
function parseCodexGitSource(source, field) {
    const hasSubdirectory = source.source === 'git-subdir';
    const allowed = new Set(['source', 'url', 'ref', 'sha', ...(hasSubdirectory ? ['path'] : [])]);
    const unsupportedKey = Object.keys(source).find(key => !allowed.has(key));
    if (unsupportedKey !== undefined)
        throw new TypeError(`${field}.${unsupportedKey} is not supported`);
    if (typeof source.url !== 'string' || !isSafeGitUrl(source.url)) {
        throw new TypeError(`${field}.url must be an HTTPS Git URL without credentials or a fragment`);
    }
    const result = { kind: 'git-repository', url: source.url };
    if (hasSubdirectory) {
        result.subdirectory = parseMarketplaceRelativeDirectory(source.path, `${field}.path`).path;
    }
    if (source.ref !== undefined)
        result.ref = nonEmptyString(source.ref, `${field}.ref`);
    if (source.sha !== undefined)
        result.sha = nonEmptyString(source.sha, `${field}.sha`);
    return result;
}
function isSafeGitUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:'
            && parsed.username.length === 0
            && parsed.password.length === 0
            && parsed.hash.length === 0;
    }
    catch {
        return false;
    }
}
function nonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${field} must be a non-empty string`);
    }
    return value;
}
export const name = 'plugin-bridge-marketplace-codex';
export const inject = ['pluginBridge'];
/** Register only the evidence-backed Codex local marketplace dialect on this Cordis row. */
export function apply(ctx) {
    ctx.pluginBridge.registerMarketplaceProvider(codexMarketplaceProvider);
}
//# sourceMappingURL=codex.js.map