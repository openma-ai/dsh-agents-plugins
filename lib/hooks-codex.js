import * as CodexHooks from '@deepseek-ai/dsh-hooks-codex';
export const name = 'plugin-bridge-hooks-codex';
export const inject = CodexHooks.inject;
export const Config = CodexHooks.Config;
/** Own the official Codex hooks plugin as a nested Bridge child. */
export async function apply(ctx, config) {
    await ctx.plugin(CodexHooks, config);
}
//# sourceMappingURL=hooks-codex.js.map