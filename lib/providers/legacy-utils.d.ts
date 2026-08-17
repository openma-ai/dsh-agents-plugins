import type { PackageComponent, PluginPackageSource } from '../kernel.js';
export declare function manifestObject(value: unknown, format: string): Record<string, unknown>;
export declare function normalizePluginPath(value: string, format: string, field: string): string;
export declare function declaredComponents(source: PluginPackageSource, manifestPath: string, manifest: Record<string, unknown>, field: string, type: string, format: string): PackageComponent[];
export declare function fixedComponent(source: PluginPackageSource, type: string, path: string): PackageComponent[];
export declare function dedupeComponents(components: readonly PackageComponent[]): readonly PackageComponent[];
//# sourceMappingURL=legacy-utils.d.ts.map