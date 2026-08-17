import type { MarketplaceCatalogProvider } from './types.js';
import type { Context } from '@deepseek-ai/cordis';
export declare const CLAUDE_CODE_MARKETPLACE_MANIFEST = ".claude-plugin/marketplace.json";
/** Claude Code's documented marketplace catalog, normalized into bridge-owned source kinds. */
export declare const claudeCodeMarketplaceProvider: MarketplaceCatalogProvider;
export declare const name = "plugin-bridge-marketplace-claude-code";
export declare const inject: string[];
/** Register only the Claude Code marketplace dialect on this Cordis row. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=claude-code.d.ts.map