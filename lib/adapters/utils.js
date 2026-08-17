import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
export function record(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must contain an object`);
    }
    return value;
}
export function packageName(input) {
    const value = input.detected.manifest.name;
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${input.detected.provider}: manifest name must be a non-empty string`);
    }
    return value;
}
export function slug(value) {
    const normalized = value.toLowerCase()
        .replace(/[^a-z0-9_-]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    return normalized.length === 0 ? 'plugin' : normalized;
}
export function boundedName(value, maxLength) {
    const normalized = slug(value);
    if (normalized.length <= maxLength)
        return normalized;
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 8);
    return `${normalized.slice(0, maxLength - digest.length - 1)}-${digest}`;
}
export function insidePlugin(input, path) {
    const root = resolve(input.source.root);
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
        throw new TypeError(`${input.detected.provider}: component path "${path}" escapes the plugin root`);
    }
    return target;
}
export function componentJson(input) {
    if (input.component.manifestField !== undefined) {
        return input.detected.manifest[input.component.manifestField];
    }
    return input.source.readJson(input.component.path);
}
//# sourceMappingURL=utils.js.map