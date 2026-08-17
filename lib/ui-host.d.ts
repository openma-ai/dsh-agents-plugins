import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** One marketplace shown by the Agent Plugins settings tab. */
export interface AgentPluginsMarketplaceView {
    readonly name: string;
    readonly provider: string;
    readonly plugins: readonly string[];
}
/** One Bridge-owned plugin installation shown by the Web client. */
export interface AgentPluginsInstallationView {
    readonly name: string;
    readonly marketplace: string;
    readonly format: string;
    readonly enabled: boolean;
    readonly rowCount: number;
    readonly protectedCount: number;
    readonly unsupportedCount: number;
    readonly diagnostics: readonly string[];
}
/** Durable Bridge state safe to expose to the Web client. */
export interface AgentPluginsSnapshot {
    readonly marketplaces: readonly AgentPluginsMarketplaceView[];
    readonly installations: readonly AgentPluginsInstallationView[];
}
/** One foreign-agent plugin found locally but not yet imported. */
export interface AgentPluginsLocalCandidateView {
    readonly ref: string;
    readonly locator: string;
    readonly name: string;
    readonly evidence: 'installed-registry' | 'plugin-cache';
    readonly version?: string;
    readonly marketplace?: string;
    readonly scope?: string;
    readonly enabled?: boolean;
}
/** Local plugin discovery result with locator failures kept as diagnostics. */
export interface AgentPluginsLocalDiscoveryView {
    readonly candidates: readonly AgentPluginsLocalCandidateView[];
    readonly diagnostics: readonly string[];
}
/** One foreign-agent marketplace registration available for import. */
export interface AgentPluginsMarketplaceCandidateView {
    readonly ref: string;
    readonly locator: string;
    readonly name: string;
    readonly sourceType: 'local' | 'git' | 'installed-checkout';
    readonly revision?: string;
}
/** Registered marketplace discovery result. */
export interface AgentPluginsMarketplaceDiscoveryView {
    readonly candidates: readonly AgentPluginsMarketplaceCandidateView[];
    readonly diagnostics: readonly string[];
}
/** Host gateway used by the Agent Plugins settings tab. */
export declare class AgentPluginsGateway extends TypertRemoteService {
    static inject: string[];
    private mutationTail;
    constructor(ctx: Context);
    private serializeMutation;
    /** @returns Current Bridge-owned marketplaces and installations. */
    snapshot(): AgentPluginsSnapshot;
    /** @returns Foreign-agent plugin installations currently visible on the Host. */
    discoverLocal(): Promise<AgentPluginsLocalDiscoveryView>;
    /** @returns Foreign-agent marketplace registrations currently visible on the Host. */
    discoverMarketplaces(): Promise<AgentPluginsMarketplaceDiscoveryView>;
    /** Add one marketplace location and return the updated durable view. */
    addMarketplace(location: string): Promise<AgentPluginsSnapshot>;
    /** Import one discovered foreign marketplace by its opaque ref. */
    importMarketplace(ref: string): Promise<AgentPluginsSnapshot>;
    /** Import one discovered foreign plugin by its opaque ref. */
    importLocal(ref: string): Promise<AgentPluginsSnapshot>;
    /** Install a named plugin from one Bridge-owned marketplace. */
    installPlugin(name: string, marketplace: string): Promise<AgentPluginsSnapshot>;
    /** Enable or disable one Bridge-owned installation. */
    setEnabled(name: string, enabled: boolean): Promise<AgentPluginsSnapshot>;
}
export default AgentPluginsGateway;
//# sourceMappingURL=ui-host.d.ts.map