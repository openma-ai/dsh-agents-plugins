import type { Context } from '@deepseek-ai/cordis';
import type { MarketplaceRegistrationLocator } from '../kernel.js';
export declare const name = "plugin-bridge-discovery-codex-marketplaces";
export declare const inject: string[];
export interface Config {
    readonly configPath?: string;
}
/** Observes only Codex's explicit `[marketplaces.<name>]` config registrations. */
export declare function createCodexMarketplaceRegistrationLocator(config?: Config): MarketplaceRegistrationLocator;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=codex-marketplaces.d.ts.map