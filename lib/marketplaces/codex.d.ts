import type { MarketplaceCatalogProvider } from './types.js';
import type { Context } from '@deepseek-ai/cordis';
export declare const CODEX_MARKETPLACE_MANIFEST = ".agents/plugins/marketplace.json";
export declare const CODEX_LEGACY_MARKETPLACE_MANIFEST = "marketplace.json";
/**
 * Codex's observed local catalog shape.
 *
 * No public remote marketplace wire format is assumed here: additional source
 * kinds must be introduced from published documentation or a real fixture.
 */
export declare const codexMarketplaceProvider: MarketplaceCatalogProvider;
export declare const name = "plugin-bridge-marketplace-codex";
export declare const inject: string[];
/** Register only the evidence-backed Codex local marketplace dialect on this Cordis row. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=codex.d.ts.map