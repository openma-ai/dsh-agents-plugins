import type { PluginBridgeRemoteApi, PluginBridgeRemoteResult, PluginBridgeInstallFailureReason, PluginBridgeSnapshot, PluginBridgeView } from '../types.ts';
export declare class PluginBridgeInstallError extends Error {
    readonly reason: PluginBridgeInstallFailureReason;
    constructor(reason: PluginBridgeInstallFailureReason);
}
/** Load the durable, local-discovery, and marketplace-discovery views together. */
export declare function loadPluginBridgeView(api: PluginBridgeRemoteApi): Promise<PluginBridgeView>;
/** Refresh foreign discovery while retaining a mutation's authoritative durable snapshot. */
export declare function loadPluginBridgeDiscoveries(api: PluginBridgeRemoteApi, snapshot: PluginBridgeSnapshot): Promise<PluginBridgeView>;
/** Unwrap one mutation response using its Host endpoint name. */
export declare function unwrapPluginBridgeMutation<T>(endpoint: string, result: PluginBridgeRemoteResult<T>): T;
//# sourceMappingURL=view-model.d.ts.map