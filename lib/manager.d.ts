import type { ActivationInspection, ActivationRequirement, DshPluginRow, InstalledPluginCandidate, MarketplaceRegistrationCandidate, PackageComponent, PluginBridgeKernel, RuntimeRequirement } from './kernel.js';
import type { MarketplacePluginEntry } from './marketplaces/types.js';
/** Minimal Loader face used to mount each materialized row independently. */
export interface BridgeLoader {
    create(row: DshPluginRow): Promise<string>;
    remove(id: string): Promise<void>;
}
/** Git checkout operation used for marketplace repositories and plugin sources. */
export interface GitRepositoryAcquirer {
    clone(repo: string, destination: string, revision: {
        readonly ref?: string;
        readonly sha?: string;
    }): Promise<void>;
    /** Clone a provider-validated HTTPS Git URL without invoking a shell. */
    cloneUrl?(url: string, destination: string, revision: {
        readonly ref?: string;
        readonly sha?: string;
    }): Promise<void>;
}
/** Injectable host operations; production defaults to argument-only `git`. */
export interface PluginBridgeManagerOptions {
    readonly git?: GitRepositoryAcquirer;
}
export type PluginInstallPhase = 'activation';
/** Installation failure annotated with the transaction phase that failed. */
export declare class PluginInstallOperationError extends Error {
    readonly phase: PluginInstallPhase;
    constructor(phase: PluginInstallPhase, cause: unknown);
}
/** Durable marketplace registration. */
export interface RegisteredMarketplace {
    readonly name: string;
    readonly provider: string;
    readonly root: string;
    readonly manifestPath: string;
    readonly plugins: readonly MarketplacePluginEntry[];
}
/** Durable installed plugin and its exact dsh row plan. */
export interface InstalledPlugin {
    readonly name: string;
    readonly marketplace: string;
    readonly format: string;
    readonly root: string;
    readonly rows: readonly DshPluginRow[];
    readonly activations: readonly ActivationRequirement[];
    readonly requirements: readonly RuntimeRequirement[];
    readonly unsupported: readonly PackageComponent[];
    readonly diagnostics?: readonly string[];
    readonly enabled: boolean;
}
/** Durable user trust for one exact row definition digest. */
export interface ActivationApproval {
    readonly policy: string;
    readonly rowId: string;
    readonly digest: string;
}
/** Current human-review view of one gated installed row. */
export interface ActivationReview extends ActivationInspection {
    readonly plugin: string;
    readonly approved: boolean;
}
/** One read-only foreign plugin observation, addressable by an explicit import ref. */
export interface DiscoveredLocalPlugin extends InstalledPluginCandidate {
    readonly ref: string;
    readonly locator: string;
}
/** Aggregate discovery output with provider-local failures kept as diagnostics. */
export interface LocalPluginDiscovery {
    readonly candidates: readonly DiscoveredLocalPlugin[];
    readonly diagnostics: readonly string[];
}
export interface DiscoveredRegisteredMarketplace extends MarketplaceRegistrationCandidate {
    readonly ref: string;
    readonly locator: string;
}
export interface RegisteredMarketplaceDiscovery {
    readonly candidates: readonly DiscoveredRegisteredMarketplace[];
    readonly diagnostics: readonly string[];
}
/** Human-command management face implemented by the persistent manager service. */
export interface PluginBridgeManagement {
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
    enable(name: string): Promise<void>;
    disable(name: string): Promise<void>;
    uninstall(name: string): Promise<void>;
}
/** Owns marketplace state, package copies, Loader transactions, and restart restoration. */
export declare class PluginBridgeManager {
    private readonly kernel;
    private readonly loader;
    readonly storageDir: string;
    private readonly options;
    private state;
    private readonly activeRowIds;
    private started;
    constructor(kernel: PluginBridgeKernel, loader: BridgeLoader, storageDir: string, options?: PluginBridgeManagerOptions);
    listMarketplaces(): readonly RegisteredMarketplace[];
    listInstallations(): readonly InstalledPlugin[];
    /** Scan every foreign-agent locator without activating or modifying any package. */
    discoverLocalPlugins(): Promise<LocalPluginDiscovery>;
    /** Aggregate explicit foreign marketplace registrations without changing bridge state. */
    discoverRegisteredMarketplaces(): Promise<RegisteredMarketplaceDiscovery>;
    /** Import one selected registered marketplace through the existing catalog manager. */
    importRegisteredMarketplace(ref: string): Promise<RegisteredMarketplace>;
    /** Copy one explicitly selected foreign package, then activate only its copied row plan. */
    importLocalPlugin(ref: string): Promise<InstalledPlugin>;
    /** Restore the exact stored row plans before accepting management commands. */
    start(): Promise<void>;
    /** Register one local Codex or Claude marketplace directory. */
    addMarketplace(location: string): Promise<RegisteredMarketplace>;
    /** Acquire and activate one `plugin@marketplace` selection transactionally. */
    install(spec: string): Promise<InstalledPlugin>;
    /** Review current gated component definitions without trusting or activating them. */
    reviewActivations(policyName: string, pluginName?: string): Promise<readonly ActivationReview[]>;
    /** Trust and activate the exact current digest; a stale digest is never accepted. */
    approveActivation(policyName: string, pluginName: string, digest: string): Promise<void>;
    /** Disable one installed plugin while keeping its copied package and row plan. */
    disable(name: string): Promise<void>;
    /** Re-activate the stored row plan for one disabled installation. */
    enable(name: string): Promise<void>;
    /** Remove an installation; its package copy moves to the bridge trash directory. */
    uninstall(name: string): Promise<void>;
    /** Quiesce every row this manager activated without changing durable enablement. */
    dispose(): Promise<void>;
    private ensureStarted;
    private isApproved;
    private rowsAllowedByPolicy;
    /** Refresh digests, revoke stale approvals, and quiesce rows whose trust changed. */
    private refreshInstallationActivations;
    private rowsAllowedByPolicyWithApprovals;
    /** Cordis Loader owns and normalizes the options object it receives. */
    private createRow;
    private acquireSource;
    private removeRows;
    private statePath;
    private writeState;
    private moveToTrash;
}
//# sourceMappingURL=manager.d.ts.map