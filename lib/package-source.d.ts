import type { PluginPackageEntryKind, PluginPackageSource } from './kernel.js';
/** Filesystem-backed package view that rejects paths and symlinks outside its root. */
export declare class DirectoryPackageSource implements PluginPackageSource {
    readonly root: string;
    constructor(root: string);
    has(path: string): boolean;
    kind(path: string): PluginPackageEntryKind | undefined;
    readJson(path: string): unknown;
    readText(path: string): string;
    private resolve;
    private assertRealTarget;
}
//# sourceMappingURL=package-source.d.ts.map