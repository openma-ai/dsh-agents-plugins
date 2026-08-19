import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { createRequire } from 'node:module'

const requireFromBridge = createRequire(import.meta.url)

/** Mount one direct runtime dependency from Bridge's own package graph. */
export async function mountOwnedDependency(
  ctx: Context,
  specifier: string,
  config: unknown,
): Promise<void> {
  const exports = await ctx.loader.import(requireFromBridge.resolve(specifier))
  const plugin = ctx.loader.unwrapExports(exports)
  await ctx.plugin(plugin, config)
}
