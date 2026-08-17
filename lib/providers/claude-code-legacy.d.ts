import type { Context } from '@deepseek-ai/cordis';
import type { PackageFormatProvider } from '../kernel.js';
/** Claude Code plugin layout rooted at `.claude-plugin/plugin.json`. */
export declare const claudeCodeLegacyProvider: PackageFormatProvider;
export declare const name = "plugin-bridge-format-claude-code-legacy";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=claude-code-legacy.d.ts.map