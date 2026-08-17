import type { Context } from '@deepseek-ai/cordis';
import type { PackageFormatProvider } from '../kernel.js';
/** OpenAI Codex plugin layout rooted at `.codex-plugin/plugin.json`. */
export declare const codexLegacyProvider: PackageFormatProvider;
export declare const name = "plugin-bridge-format-codex-legacy";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=codex-legacy.d.ts.map