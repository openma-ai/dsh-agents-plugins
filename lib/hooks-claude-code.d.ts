import type { Context } from '@deepseek-ai/cordis';
import * as ClaudeCodeHooks from '@deepseek-ai/dsh-hooks-claude-code';
export declare const name = "plugin-bridge-hooks-claude-code";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ClaudeCodeHooks.Config>;
export type Config = import('@deepseek-ai/dsh-hooks-claude-code').Config;
/** Own the official Claude Code hooks plugin as a nested Bridge child. */
export declare function apply(ctx: Context, config: Config): Promise<void>;
//# sourceMappingURL=hooks-claude-code.d.ts.map