export function requireRecord(value, field) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${field} must be an object`);
    }
    return value;
}
export function requireIdentifier(value, field) {
    if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
        throw new TypeError(`${field} must be a kebab-case identifier`);
    }
    return value;
}
export function requirePlugins(manifest) {
    if (!Array.isArray(manifest.plugins)) {
        throw new TypeError('marketplace.plugins must be an array');
    }
    return manifest.plugins;
}
export function parseMarketplaceRelativeDirectory(value, field) {
    if (typeof value !== 'string' || !isSafeMarketplaceRelativePath(value)) {
        throw new TypeError(`${field} must be a root-contained path beginning with "./"`);
    }
    return { kind: 'marketplace-relative-directory', path: value };
}
export function parseGitHubRepositorySource(value, field) {
    const unsupportedKey = Object.keys(value).find(key => key !== 'source' && key !== 'repo' && key !== 'ref' && key !== 'sha');
    if (unsupportedKey !== undefined) {
        throw new TypeError(`${field}.${unsupportedKey} is not supported`);
    }
    if (value.source !== 'github') {
        throw new TypeError(`${field}.source must be "github"`);
    }
    if (typeof value.repo !== 'string' || !isGitHubOwnerRepo(value.repo)) {
        throw new TypeError(`${field}.repo must use the "owner/repo" form`);
    }
    const result = { kind: 'github-repository', repo: value.repo };
    if (value.ref !== undefined)
        result.ref = requireNonEmptyString(value.ref, `${field}.ref`);
    if (value.sha !== undefined)
        result.sha = requireNonEmptyString(value.sha, `${field}.sha`);
    return result;
}
/** Parse the documented `url` and `git-subdir` source shapes without shell URLs. */
export function parseGitRepositorySource(source, field, options = {}) {
    const hasSubdirectory = source.source === 'git-subdir'
        || (source.source === 'url' && options.allowUrlSubdirectory === true && source.path !== undefined);
    if (source.source !== 'url' && source.source !== 'git-subdir') {
        throw new TypeError(`${field}.source must be "url" or "git-subdir"`);
    }
    const allowed = new Set(['source', 'url', 'ref', 'sha', ...(hasSubdirectory ? ['path'] : [])]);
    const unsupportedKey = Object.keys(source).find(key => !allowed.has(key));
    if (unsupportedKey !== undefined)
        throw new TypeError(`${field}.${unsupportedKey} is not supported`);
    if (typeof source.url !== 'string' || !isSafeGitUrl(source.url)) {
        throw new TypeError(`${field}.url must be an HTTPS Git URL without credentials or a fragment`);
    }
    const result = { kind: 'git-repository', url: source.url };
    if (hasSubdirectory) {
        result.subdirectory = parseRepositorySubdirectory(source.path, `${field}.path`);
    }
    if (source.ref !== undefined)
        result.ref = requireNonEmptyString(source.ref, `${field}.ref`);
    if (source.sha !== undefined)
        result.sha = requireNonEmptyString(source.sha, `${field}.sha`);
    return result;
}
export function parsePluginEntry(value, index, parseSource) {
    const field = `marketplace.plugins[${index}]`;
    const entry = requireRecord(value, field);
    return {
        name: requireIdentifier(entry.name, `${field}.name`),
        source: parseSource(entry.source, `${field}.source`),
    };
}
export function requireUniquePluginNames(entries) {
    const names = new Set();
    for (const entry of entries) {
        if (names.has(entry.name))
            throw new TypeError(`duplicate plugin name "${entry.name}"`);
        names.add(entry.name);
    }
}
function isSafeMarketplaceRelativePath(value) {
    if (!value.startsWith('./') || value.includes('\\') || value.includes('\0'))
        return false;
    const segments = value.slice(2).split('/');
    return segments.length > 0 && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
function parseRepositorySubdirectory(value, field) {
    if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) {
        throw new TypeError(`${field} must be a root-contained repository path`);
    }
    const normalized = value.startsWith('./') ? value.slice(2) : value;
    const segments = normalized.split('/');
    if (segments.length === 0
        || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        throw new TypeError(`${field} must be a root-contained repository path`);
    }
    return value;
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
function isGitHubOwnerRepo(value) {
    const segments = value.split('/');
    return segments.length === 2 && segments.every(segment => /^[A-Za-z0-9_.-]+$/.test(segment));
}
function requireNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${field} must be a non-empty string`);
    }
    return value;
}
//# sourceMappingURL=validation.js.map