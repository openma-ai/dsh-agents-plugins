import * as ClaudeCodeHooks from '@deepseek-ai/dsh-hooks-claude-code';
export const name = 'plugin-bridge-hooks-claude-code';
export const inject = ClaudeCodeHooks.inject;
export const Config = ClaudeCodeHooks.Config;
/** Own the official Claude Code hooks plugin as a nested Bridge child. */
export async function apply(ctx, config) {
    await ctx.plugin(ClaudeCodeHooks, config);
}
//# sourceMappingURL=hooks-claude-code.js.map