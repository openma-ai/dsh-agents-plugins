import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireFromBridge = createRequire(import.meta.url);
/** Mount one direct runtime dependency from Bridge's own package graph. */
export async function mountOwnedDependency(ctx, specifier, config) {
    const exports = await ctx.loader.import(pathToFileURL(requireFromBridge.resolve(specifier)).href);
    const plugin = ctx.loader.unwrapExports(exports);
    await ctx.plugin(plugin, config);
}
//# sourceMappingURL=owned-dependency.js.map