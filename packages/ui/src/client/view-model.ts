import type {
  PluginBridgeRemoteApi,
  PluginBridgeRemoteResult,
  PluginBridgeInstallFailureReason,
  PluginBridgeSnapshot,
  PluginBridgeView,
} from '../types.ts'

export class PluginBridgeInstallError extends Error {
  constructor(readonly reason: PluginBridgeInstallFailureReason) {
    super(`Plugin install failed: ${reason}`)
    this.name = 'PluginBridgeInstallError'
  }
}

function unwrap<T>(endpoint: string, result: PluginBridgeRemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`agentPluginsBridge.${endpoint} failed: ${result.error.code}: ${result.error.message}`)
}

/** Load the durable, local-discovery, and marketplace-discovery views together. */
export async function loadPluginBridgeView(api: PluginBridgeRemoteApi): Promise<PluginBridgeView> {
  const [snapshot, local, marketplaces] = await Promise.all([
    api.snapshot(),
    api.discoverLocal(),
    api.discoverMarketplaces(),
  ])
  return {
    snapshot: unwrap('snapshot', snapshot),
    local: unwrap('discoverLocal', local),
    marketplaces: unwrap('discoverMarketplaces', marketplaces),
  }
}

/** Refresh foreign discovery while retaining a mutation's authoritative durable snapshot. */
export async function loadPluginBridgeDiscoveries(
  api: PluginBridgeRemoteApi,
  snapshot: PluginBridgeSnapshot,
): Promise<PluginBridgeView> {
  const [local, marketplaces] = await Promise.all([
    api.discoverLocal(),
    api.discoverMarketplaces(),
  ])
  return {
    snapshot,
    local: unwrap('discoverLocal', local),
    marketplaces: unwrap('discoverMarketplaces', marketplaces),
  }
}

/** Unwrap one mutation response using its Host endpoint name. */
export function unwrapPluginBridgeMutation<T>(
  endpoint: string,
  result: PluginBridgeRemoteResult<T>,
): T {
  return unwrap(endpoint, result)
}
