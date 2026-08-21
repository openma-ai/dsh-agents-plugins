/** Browser-safe view of one configured marketplace. */
export interface PluginBridgeMarketplaceView {
  readonly name: string
  readonly provider: string
  readonly plugins: readonly string[]
}

/** Browser-safe view of one Bridge-owned installation. */
export interface PluginBridgeInstallationView {
  readonly name: string
  readonly marketplace: string
  readonly format: string
  readonly enabled: boolean
  readonly rowCount: number
  readonly protectedCount: number
  readonly requiredHosts: readonly string[]
  readonly unsupportedCount: number
  readonly diagnostics: readonly string[]
}

/** Durable Bridge state exposed by the Host gateway. */
export interface PluginBridgeSnapshot {
  readonly marketplaces: readonly PluginBridgeMarketplaceView[]
  readonly installations: readonly PluginBridgeInstallationView[]
}

export type PluginBridgeInstallFailureReason =
  | 'timeout'
  | 'source'
  | 'unsupported'
  | 'invalid'
  | 'activation'
  | 'already-installed'
  | 'unknown'

export type PluginBridgeInstallResult =
  | { readonly status: 'installed'; readonly snapshot: PluginBridgeSnapshot }
  | { readonly status: 'failed'; readonly reason: PluginBridgeInstallFailureReason }

/** One installed foreign plugin that has not been imported into DSH. */
export interface PluginBridgeLocalCandidateView {
  readonly ref: string
  readonly locator: string
  readonly name: string
  readonly evidence: 'installed-registry' | 'plugin-cache'
  readonly version?: string
  readonly marketplace?: string
  readonly scope?: string
  readonly enabled?: boolean
}

/** Read-only discovery result for local foreign-agent plugins. */
export interface PluginBridgeLocalDiscoveryView {
  readonly candidates: readonly PluginBridgeLocalCandidateView[]
  readonly diagnostics: readonly string[]
}

/** One registered foreign-agent marketplace that can be imported. */
export interface PluginBridgeMarketplaceCandidateView {
  readonly ref: string
  readonly locator: string
  readonly name: string
  readonly sourceType: 'local' | 'git' | 'installed-checkout'
  readonly revision?: string
}

/** Read-only discovery result for registered foreign-agent marketplaces. */
export interface PluginBridgeMarketplaceDiscoveryView {
  readonly candidates: readonly PluginBridgeMarketplaceCandidateView[]
  readonly diagnostics: readonly string[]
}

export type PluginBridgePiUpdateMode = 'notify' | 'auto' | 'off'

export interface PluginBridgePiPackageUpdateView {
  readonly id: string
  readonly displayName: string
  readonly type: 'npm' | 'git'
  readonly scope: 'user' | 'project'
  readonly autoUpdate: boolean
}

export interface PluginBridgePiUpdateStatus {
  readonly mode: PluginBridgePiUpdateMode
  readonly updates: readonly PluginBridgePiPackageUpdateView[]
  readonly lastCheckedAt?: number
  readonly nextCheckAt?: number
}

/** Strict Typert Remote outcome used by the generated bridge descriptor. */
export type PluginBridgeRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string; readonly details: object }
    }

/** Browser projection of the `agentPluginsBridge` Remote namespace. */
export interface PluginBridgeRemoteApi {
  snapshot(): Promise<PluginBridgeRemoteResult<PluginBridgeSnapshot>>
  discoverLocal(): Promise<PluginBridgeRemoteResult<PluginBridgeLocalDiscoveryView>>
  discoverMarketplaces(): Promise<PluginBridgeRemoteResult<PluginBridgeMarketplaceDiscoveryView>>
  addMarketplace(location: string): Promise<PluginBridgeRemoteResult<PluginBridgeSnapshot>>
  importMarketplace(ref: string): Promise<PluginBridgeRemoteResult<PluginBridgeSnapshot>>
  importLocal(ref: string): Promise<PluginBridgeRemoteResult<PluginBridgeSnapshot>>
  installPlugin(name: string, marketplace: string): Promise<PluginBridgeRemoteResult<PluginBridgeInstallResult>>
  setEnabled(name: string, enabled: boolean): Promise<PluginBridgeRemoteResult<PluginBridgeSnapshot>>
  piUpdates(): Promise<PluginBridgeRemoteResult<PluginBridgePiUpdateStatus>>
  checkPiUpdates(): Promise<PluginBridgeRemoteResult<PluginBridgePiUpdateStatus>>
  setPiUpdateMode(mode: PluginBridgePiUpdateMode): Promise<PluginBridgeRemoteResult<PluginBridgePiUpdateStatus>>
  setPiPackageAutoUpdate(id: string, enabled: boolean): Promise<PluginBridgeRemoteResult<PluginBridgePiUpdateStatus>>
  updatePiPackage(id: string): Promise<PluginBridgeRemoteResult<PluginBridgePiUpdateStatus>>
  updateAllPiPackages(): Promise<PluginBridgeRemoteResult<PluginBridgePiUpdateStatus>>
}

/** Combined model rendered by the Web settings tab. */
export interface PluginBridgeView {
  readonly snapshot: PluginBridgeSnapshot
  readonly local: PluginBridgeLocalDiscoveryView
  readonly marketplaces: PluginBridgeMarketplaceDiscoveryView
  readonly piUpdates: PluginBridgePiUpdateStatus
}
