export class PluginBridgeInstallError extends Error {
    reason;
    constructor(reason) {
        super(`Plugin install failed: ${reason}`);
        this.reason = reason;
        this.name = 'PluginBridgeInstallError';
    }
}
function unwrap(endpoint, result) {
    if (result.ok)
        return result.value;
    throw new Error(`agentPluginsBridge.${endpoint} failed: ${result.error.code}: ${result.error.message}`);
}
/** Load the durable, local-discovery, and marketplace-discovery views together. */
export async function loadPluginBridgeView(api) {
    const [snapshot, local, marketplaces] = await Promise.all([
        api.snapshot(),
        api.discoverLocal(),
        api.discoverMarketplaces(),
    ]);
    return {
        snapshot: unwrap('snapshot', snapshot),
        local: unwrap('discoverLocal', local),
        marketplaces: unwrap('discoverMarketplaces', marketplaces),
    };
}
/** Refresh foreign discovery while retaining a mutation's authoritative durable snapshot. */
export async function loadPluginBridgeDiscoveries(api, snapshot) {
    const [local, marketplaces] = await Promise.all([
        api.discoverLocal(),
        api.discoverMarketplaces(),
    ]);
    return {
        snapshot,
        local: unwrap('discoverLocal', local),
        marketplaces: unwrap('discoverMarketplaces', marketplaces),
    };
}
/** Unwrap one mutation response using its Host endpoint name. */
export function unwrapPluginBridgeMutation(endpoint, result) {
    return unwrap(endpoint, result);
}
//# sourceMappingURL=view-model.js.map