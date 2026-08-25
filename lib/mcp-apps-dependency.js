import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireFromBridge = createRequire(import.meta.url);
const requireFromMcpApps = createRequire(requireFromBridge.resolve('@openma/dsh-mcp-apps/package.json'));
/** Mount one MCP Apps runtime from Bridge's declared dependency graph. */
export async function mountMcpAppsDependency(ctx, specifier, config) {
    const exports = await ctx.loader.import(pathToFileURL(requireFromMcpApps.resolve(specifier)).href);
    const plugin = ctx.loader.unwrapExports(exports);
    await ctx.plugin(plugin, config);
}
//# sourceMappingURL=mcp-apps-dependency.js.map