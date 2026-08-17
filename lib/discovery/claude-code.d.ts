import type { Context } from '@deepseek-ai/cordis';
import type { InstalledPluginLocator } from '../kernel.js';
export declare const name = "plugin-bridge-discovery-claude-code";
export declare const inject: string[];
export interface Config {
    /** Override for tests or a non-default Claude configuration directory. */
    readonly registryPath?: string;
}
/** Reads Claude Code's explicit installed_plugins.json registry without scanning its marketplaces. */
export declare function createClaudeCodeInstalledPluginLocator(config?: Config): InstalledPluginLocator;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=claude-code.d.ts.map