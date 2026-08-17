import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import { type ActivationReview, type InstalledPlugin, type LocalPluginDiscovery, type RegisteredMarketplace, type RegisteredMarketplaceDiscovery } from './manager.js';
export declare const name = "plugin-bridge-runtime";
export declare const inject: string[];
/** Optional profile-local storage override. */
export interface Config {
    readonly storageDir?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        pluginBridgeRuntime: PluginBridgeRuntime;
    }
}
/** Cordis service facade over the persistent marketplace and installation manager. */
export declare class PluginBridgeRuntime extends Service {
    private readonly manager;
    constructor(ctx: Context, config?: Config);
    start(): Promise<void>;
    listMarketplaces(): readonly RegisteredMarketplace[];
    listInstallations(): readonly InstalledPlugin[];
    addMarketplace(location: string): Promise<RegisteredMarketplace>;
    install(spec: string): Promise<InstalledPlugin>;
    discoverLocalPlugins(): Promise<LocalPluginDiscovery>;
    importLocalPlugin(ref: string): Promise<InstalledPlugin>;
    discoverRegisteredMarketplaces(): Promise<RegisteredMarketplaceDiscovery>;
    importRegisteredMarketplace(ref: string): Promise<RegisteredMarketplace>;
    reviewActivations(policy: string, plugin?: string): Promise<readonly ActivationReview[]>;
    approveActivation(policy: string, plugin: string, digest: string): Promise<void>;
    disable(pluginName: string): Promise<void>;
    enable(pluginName: string): Promise<void>;
    uninstall(pluginName: string): Promise<void>;
    dispose(): Promise<void>;
}
/** Publish the runtime only after all persisted rows activate successfully. */
export declare function apply(ctx: Context, config?: Config): Promise<void>;
//# sourceMappingURL=runtime.d.ts.map