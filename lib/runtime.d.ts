import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import { type ActivationReview, type InstalledPlugin, type LocalPluginDiscovery, type PluginAutoUpdateReport, type RegisteredMarketplace, type RegisteredMarketplaceDiscovery } from './manager.js';
import { type ImportedPiPackage, type PiUpdateMode, type PiUpdateStatus } from './pi-updates.js';
interface ImportedInstallationSourceView {
    readonly source?: {
        readonly locator: string;
        readonly upstreamSource?: string;
    };
}
/** Select native Pi package identities from durable Bridge imports. */
export declare function listImportedPiPackages(installations: readonly ImportedInstallationSourceView[]): readonly ImportedPiPackage[];
export declare const name = "plugin-bridge-runtime";
export declare const inject: string[];
/** Optional profile-local storage override. */
export interface Config {
    readonly storageDir?: string;
    /** Poll supported hosts' installed package state; zero disables automatic reconciliation. */
    readonly autoUpdateIntervalMs?: number;
    /** Ask Pi for native package updates at this interval; zero disables background checks. */
    readonly piUpdateCheckIntervalMs?: number;
    /** Project directory used for Pi's project-scoped package settings. */
    readonly piCwd?: string;
}
/** Start best-effort reconciliation and return its lifecycle cleanup. */
export declare function startPluginAutoUpdates(sync: () => Promise<void>, intervalMs: number): () => Promise<void>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        pluginBridgeRuntime: PluginBridgeRuntime;
    }
}
/** Cordis service facade over the persistent marketplace and installation manager. */
export declare class PluginBridgeRuntime extends Service {
    private readonly manager;
    private readonly piUpdates;
    constructor(ctx: Context, config?: Config);
    start(): Promise<void>;
    listMarketplaces(): readonly RegisteredMarketplace[];
    listInstallations(): readonly InstalledPlugin[];
    addMarketplace(location: string): Promise<RegisteredMarketplace>;
    install(spec: string): Promise<InstalledPlugin>;
    discoverLocalPlugins(): Promise<LocalPluginDiscovery>;
    importLocalPlugin(ref: string): Promise<InstalledPlugin>;
    syncImportedPlugins(): Promise<PluginAutoUpdateReport>;
    piUpdateStatus(): PiUpdateStatus;
    checkPiUpdates(): Promise<PiUpdateStatus>;
    runScheduledPiUpdateCheck(): Promise<PiUpdateStatus>;
    setPiUpdateMode(mode: PiUpdateMode): Promise<PiUpdateStatus>;
    setPiPackageAutoUpdate(id: string, enabled: boolean): Promise<PiUpdateStatus>;
    updatePiPackage(id: string): Promise<PiUpdateStatus>;
    updateAllPiPackages(): Promise<PiUpdateStatus>;
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
export {};
//# sourceMappingURL=runtime.d.ts.map