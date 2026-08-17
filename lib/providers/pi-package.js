import { posix } from 'node:path';
const FORMAT = 'pi-package';
const MANIFEST_PATH = 'package.json';
const RESOURCES = [
    { field: 'extensions', type: 'pi-extension', convention: 'extensions/' },
    { field: 'skills', type: 'skill', convention: 'skills/' },
    { field: 'prompts', type: 'pi-prompt', convention: 'prompts/' },
    { field: 'themes', type: 'pi-theme', convention: 'themes/' },
];
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function packageManifest(value) {
    if (!record(value))
        throw new TypeError(`${FORMAT}: package.json must contain an object`);
    if (typeof value.name !== 'string' || value.name.trim().length === 0) {
        throw new TypeError(`${FORMAT}: package.json field "name" must be a non-empty string`);
    }
    return value;
}
function normalizeResourcePath(value, field) {
    if (value.length === 0) {
        throw new TypeError(`${FORMAT}: pi.${field} entries must be non-empty paths`);
    }
    const exclusion = value.startsWith('!');
    const rawPath = exclusion ? value.slice(1) : value;
    if (rawPath.length === 0 || rawPath.includes('\\') || rawPath.includes('\0') || posix.isAbsolute(rawPath)) {
        throw new TypeError(`${FORMAT}: pi.${field} entry "${value}" must remain within the package root`);
    }
    const withoutPrefix = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath;
    const normalized = posix.normalize(withoutPrefix);
    if (normalized.length === 0
        || normalized === '.'
        || normalized === '..'
        || normalized.startsWith('../')) {
        throw new TypeError(`${FORMAT}: pi.${field} entry "${value}" must remain within the package root`);
    }
    return `${exclusion ? '!' : ''}${normalized}`;
}
function isPattern(path) {
    return path.startsWith('!') || /[*?\[\]{}()]/u.test(path);
}
function asDirectory(path) {
    return path.endsWith('/') ? path : `${path}/`;
}
function declaredResources(source, pi) {
    const components = [];
    const diagnostics = [];
    for (const resource of RESOURCES) {
        const declared = pi[resource.field];
        if (declared === undefined)
            continue;
        if (!Array.isArray(declared) || declared.some(entry => typeof entry !== 'string')) {
            throw new TypeError(`${FORMAT}: pi.${resource.field} must be an array of strings`);
        }
        for (const entry of declared) {
            const path = normalizeResourcePath(entry, resource.field);
            if (isPattern(path)) {
                components.push({
                    type: `${resource.type}-pattern`,
                    path,
                });
                diagnostics.push(`${FORMAT}: pi.${resource.field} pattern "${entry}" requires a Pi-specific adapter`);
                continue;
            }
            if (!source.has(path)) {
                diagnostics.push(`${FORMAT}: pi.${resource.field} path "${entry}" does not exist; resource disabled`);
                continue;
            }
            const kind = source.kind(path);
            if (resource.field === 'skills' && kind !== 'directory') {
                components.push({ type: 'pi-skill-file', path });
                diagnostics.push(`${FORMAT}: pi.skills path "${entry}" is not a directory and requires a Pi-specific adapter`);
                continue;
            }
            components.push({
                type: resource.type,
                path: kind === 'directory' ? asDirectory(path) : path,
            });
        }
    }
    return {
        components: Object.freeze(components),
        diagnostics: Object.freeze(diagnostics),
    };
}
function conventionalResources(source) {
    const components = [];
    const diagnostics = [];
    for (const resource of RESOURCES) {
        if (!source.has(resource.convention))
            continue;
        if (source.kind(resource.convention) !== 'directory') {
            diagnostics.push(`${FORMAT}: ${resource.convention} must be a directory; resource disabled`);
            continue;
        }
        components.push({ type: resource.type, path: resource.convention });
    }
    return {
        claimed: components.length > 0,
        components: Object.freeze(components),
        diagnostics: Object.freeze(diagnostics),
    };
}
/** Pi package.json dialect. Runtime-specific Pi resources remain explicit and inert. */
export const piPackageProvider = {
    name: FORMAT,
    probe(source) {
        if (!source.has(MANIFEST_PATH) || source.kind(MANIFEST_PATH) !== 'file')
            return undefined;
        const manifest = packageManifest(source.readJson(MANIFEST_PATH));
        if (Object.hasOwn(manifest, 'pi')) {
            if (!record(manifest.pi))
                throw new TypeError(`${FORMAT}: package.json field "pi" must be an object`);
            const observation = declaredResources(source, manifest.pi);
            return {
                manifestPath: MANIFEST_PATH,
                manifest: Object.freeze({ ...manifest }),
                components: observation.components,
                ...observation.diagnostics.length === 0
                    ? {}
                    : { diagnostics: observation.diagnostics },
            };
        }
        const observation = conventionalResources(source);
        if (!observation.claimed)
            return undefined;
        return {
            manifestPath: MANIFEST_PATH,
            manifest: Object.freeze({ ...manifest }),
            components: observation.components,
            ...observation.diagnostics.length === 0
                ? {}
                : { diagnostics: observation.diagnostics },
        };
    },
};
export const name = 'plugin-bridge-format-pi-package';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerPackageFormatProvider(piPackageProvider);
}
//# sourceMappingURL=pi-package.js.map