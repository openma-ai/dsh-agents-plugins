import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireFromBridge = createRequire(import.meta.url)
const requireFromMcpApps = createRequire(
  requireFromBridge.resolve('@openma/dsh-mcp-apps/package.json'),
)

/** Mount one MCP Apps runtime from Bridge's declared dependency graph. */
export async function mountMcpAppsDependency(
  ctx: Context,
  specifier: string,
  config: unknown,
): Promise<void> {
  const exports = await ctx.loader.import(pathToFileURL(requireFromMcpApps.resolve(specifier)).href)
  const plugin = ctx.loader.unwrapExports(exports)
  await ctx.plugin(plugin, config)
}
