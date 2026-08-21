import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import type { AgentPluginsLocalDiscoveryView, AgentPluginsInstallResult, AgentPluginsMarketplaceDiscoveryView, AgentPluginsPiUpdateMode, AgentPluginsPiUpdateStatus, AgentPluginsSnapshot } from './ui-host.js';
/** Browser projection of the Bridge Host Remote namespace. */
export interface AgentPluginsRemoteApi {
    snapshot(): Promise<RemoteResult<AgentPluginsSnapshot>>;
    discoverLocal(): Promise<RemoteResult<AgentPluginsLocalDiscoveryView>>;
    discoverMarketplaces(): Promise<RemoteResult<AgentPluginsMarketplaceDiscoveryView>>;
    addMarketplace(location: string): Promise<RemoteResult<AgentPluginsSnapshot>>;
    importMarketplace(ref: string): Promise<RemoteResult<AgentPluginsSnapshot>>;
    importLocal(ref: string): Promise<RemoteResult<AgentPluginsSnapshot>>;
    installPlugin(name: string, marketplace: string): Promise<RemoteResult<AgentPluginsInstallResult>>;
    setEnabled(name: string, enabled: boolean): Promise<RemoteResult<AgentPluginsSnapshot>>;
    piUpdates(): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>;
    checkPiUpdates(): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>;
    setPiUpdateMode(mode: AgentPluginsPiUpdateMode): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>;
    setPiPackageAutoUpdate(id: string, enabled: boolean): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>;
    updatePiPackage(id: string): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>;
    updateAllPiPackages(): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>;
}
/** Generated-shape Client contribution paired with the package Host manifest. */
export declare const TYPERT_REMOTE: {
    package: string;
    descriptors: {
        id: string;
        service: string;
        namespace: string;
        method: string;
        invocation: {
            kind: "direct";
        };
        parameters: readonly {
            name: string;
            wire: string;
            source: "json";
            codec: {
                mode: "strict";
                typeSymbol: string;
                schema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
            };
        }[];
        result: {
            mode: "strict";
            typeSymbol: string;
            schema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
        };
    }[];
};
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteNamespaceMap {
        agentPluginsBridge: AgentPluginsRemoteApi;
    }
}
export default TYPERT_REMOTE;
//# sourceMappingURL=remote.d.ts.map