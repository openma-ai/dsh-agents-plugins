import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import { PluginBridgeManager, } from './manager.js';
export const name = 'plugin-bridge-runtime';
export const inject = ['pluginBridge', 'loader'];
/** Cordis service facade over the persistent marketplace and installation manager. */
export class PluginBridgeRuntime extends Service {
    manager;
    constructor(ctx, config = {}) {
        super(ctx, 'pluginBridgeRuntime');
        const loader = ctx.get('loader');
        if (loader === undefined)
            throw new Error('plugin-bridge-runtime: Loader service is unavailable');
        const bridgeLoader = {
            create: row => loader.create(row),
            remove: id => loader.remove(id),
        };
        const storageDir = config.storageDir
            ?? fileURLToPath(new URL('.plugin-bridge/', ctx.baseUrl ?? new URL('.', import.meta.url).href));
        this.manager = new PluginBridgeManager(ctx.pluginBridge, bridgeLoader, storageDir);
    }
    start() {
        return this.manager.start();
    }
    listMarketplaces() {
        return this.manager.listMarketplaces();
    }
    listInstallations() {
        return this.manager.listInstallations();
    }
    addMarketplace(location) {
        return this.manager.addMarketplace(location);
    }
    install(spec) {
        return this.manager.install(spec);
    }
    discoverLocalPlugins() {
        return this.manager.discoverLocalPlugins();
    }
    importLocalPlugin(ref) {
        return this.manager.importLocalPlugin(ref);
    }
    discoverRegisteredMarketplaces() {
        return this.manager.discoverRegisteredMarketplaces();
    }
    importRegisteredMarketplace(ref) {
        return this.manager.importRegisteredMarketplace(ref);
    }
    reviewActivations(policy, plugin) {
        return this.manager.reviewActivations(policy, plugin);
    }
    approveActivation(policy, plugin, digest) {
        return this.manager.approveActivation(policy, plugin, digest);
    }
    disable(pluginName) {
        return this.manager.disable(pluginName);
    }
    enable(pluginName) {
        return this.manager.enable(pluginName);
    }
    uninstall(pluginName) {
        return this.manager.uninstall(pluginName);
    }
    dispose() {
        return this.manager.dispose();
    }
}
/** Publish the runtime only after all persisted rows activate successfully. */
export async function apply(ctx, config = {}) {
    const runtime = new PluginBridgeRuntime(ctx, config);
    await runtime.start();
    ctx.effect(() => () => runtime.dispose(), 'plugin-bridge-runtime rows');
}
//# sourceMappingURL=runtime.js.map