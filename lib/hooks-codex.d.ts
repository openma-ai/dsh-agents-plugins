import type { Context } from '@deepseek-ai/cordis';
import * as CodexHooks from '@deepseek-ai/dsh-hooks-codex';
export declare const name = "plugin-bridge-hooks-codex";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<CodexHooks.Config>;
export type Config = import('@deepseek-ai/dsh-hooks-codex').Config;
/** Own the official Codex hooks plugin as a nested Bridge child. */
export declare function apply(ctx: Context, config: Config): Promise<void>;
//# sourceMappingURL=hooks-codex.d.ts.map