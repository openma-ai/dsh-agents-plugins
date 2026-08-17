import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
function contained(root, target) {
    return target === root || target.startsWith(`${root}${sep}`);
}
/** Filesystem-backed package view that rejects paths and symlinks outside its root. */
export class DirectoryPackageSource {
    root;
    constructor(root) {
        this.root = realpathSync(root);
        if (!lstatSync(this.root).isDirectory())
            throw new TypeError(`plugin root "${root}" is not a directory`);
    }
    has(path) {
        const target = this.resolve(path);
        if (!existsSync(target))
            return false;
        this.assertRealTarget(target, path);
        return true;
    }
    kind(path) {
        const target = this.resolve(path);
        if (!existsSync(target))
            return undefined;
        this.assertRealTarget(target, path);
        const stats = statSync(target);
        if (stats.isFile())
            return 'file';
        if (stats.isDirectory())
            return 'directory';
        return 'other';
    }
    readJson(path) {
        const target = this.resolve(path);
        if (this.kind(path) !== 'file')
            throw new TypeError(`package path "${path}" is not a regular file`);
        return JSON.parse(readFileSync(target, 'utf8'));
    }
    readText(path) {
        const target = this.resolve(path);
        if (this.kind(path) !== 'file')
            throw new TypeError(`package path "${path}" is not a regular file`);
        return readFileSync(target, 'utf8');
    }
    resolve(path) {
        const target = resolve(this.root, path);
        if (!contained(this.root, target))
            throw new TypeError(`package path "${path}" escapes the plugin root`);
        return target;
    }
    assertRealTarget(target, path) {
        const real = realpathSync(target);
        if (!contained(this.root, real)) {
            throw new TypeError(`package path "${path}" resolves outside the plugin root`);
        }
    }
}
//# sourceMappingURL=package-source.js.map