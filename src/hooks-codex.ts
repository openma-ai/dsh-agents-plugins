import type { Context } from '@deepseek-ai/cordis'
import * as CodexHooks from '@deepseek-ai/dsh-hooks-codex'

export const name = 'plugin-bridge-hooks-codex'
export const inject = CodexHooks.inject
export const Config = CodexHooks.Config
export type Config = import('@deepseek-ai/dsh-hooks-codex').Config

/** Own the official Codex hooks plugin as a nested Bridge child. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(CodexHooks, config)
}
