import type { GitHubRepositorySource, MarketplacePluginEntry, MarketplaceRelativeDirectorySource } from './types.js';
export declare function requireRecord(value: unknown, field: string): Record<string, unknown>;
export declare function requireIdentifier(value: unknown, field: string): string;
export declare function requirePlugins(manifest: Record<string, unknown>): readonly unknown[];
export declare function parseMarketplaceRelativeDirectory(value: unknown, field: string): MarketplaceRelativeDirectorySource;
export declare function parseGitHubRepositorySource(value: Record<string, unknown>, field: string): GitHubRepositorySource;
export declare function parsePluginEntry(value: unknown, index: number, parseSource: (value: unknown, field: string) => MarketplacePluginEntry['source']): MarketplacePluginEntry;
export declare function requireUniquePluginNames(entries: readonly MarketplacePluginEntry[]): void;
//# sourceMappingURL=validation.d.ts.map