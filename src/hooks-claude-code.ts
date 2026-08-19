import type { Context } from '@deepseek-ai/cordis'
import * as ClaudeCodeHooks from '@deepseek-ai/dsh-hooks-claude-code'

export const name = 'plugin-bridge-hooks-claude-code'
export const inject = ClaudeCodeHooks.inject
export const Config = ClaudeCodeHooks.Config
export type Config = import('@deepseek-ai/dsh-hooks-claude-code').Config

/** Own the official Claude Code hooks plugin as a nested Bridge child. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(ClaudeCodeHooks, config)
}
