import type { Context } from '@deepseek-ai/cordis';
import type { MarketplaceRegistrationLocator } from '../kernel.js';
export declare const name = "plugin-bridge-discovery-claude-code-marketplaces";
export declare const inject: string[];
export interface Config {
    readonly registryPath?: string;
}
/** Observes Claude Code's explicit known_marketplaces.json checkout registry. */
export declare function createClaudeCodeMarketplaceRegistrationLocator(config?: Config): MarketplaceRegistrationLocator;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=claude-code-marketplaces.d.ts.map