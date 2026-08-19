import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** One marketplace shown by the Agent Plugins settings tab. */
export interface AgentPluginsMarketplaceView {
  readonly name: string
  readonly provider: string
  readonly plugins: readonly string[]
}

/** One Bridge-owned plugin installation shown by the Web client. */
export interface AgentPluginsInstallationView {
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

/** Durable Bridge state safe to expose to the Web client. */
export interface AgentPluginsSnapshot {
  readonly marketplaces: readonly AgentPluginsMarketplaceView[]
  readonly installations: readonly AgentPluginsInstallationView[]
}

export type AgentPluginsInstallFailureReason =
  | 'timeout'
  | 'source'
  | 'unsupported'
  | 'invalid'
  | 'activation'
  | 'already-installed'
  | 'unknown'

export type AgentPluginsInstallResult =
  | { readonly status: 'installed'; readonly snapshot: AgentPluginsSnapshot }
  | { readonly status: 'failed'; readonly reason: AgentPluginsInstallFailureReason }

/** One foreign-agent plugin found locally but not yet imported. */
export interface AgentPluginsLocalCandidateView {
  readonly ref: string
  readonly locator: string
  readonly name: string
  readonly evidence: 'installed-registry' | 'plugin-cache'
  readonly version?: string
  readonly marketplace?: string
  readonly scope?: string
  readonly enabled?: boolean
}

/** Local plugin discovery result with locator failures kept as diagnostics. */
export interface AgentPluginsLocalDiscoveryView {
  readonly candidates: readonly AgentPluginsLocalCandidateView[]
  readonly diagnostics: readonly string[]
}

/** One foreign-agent marketplace registration available for import. */
export interface AgentPluginsMarketplaceCandidateView {
  readonly ref: string
  readonly locator: string
  readonly name: string
  readonly sourceType: 'local' | 'git' | 'installed-checkout'
  readonly revision?: string
}

/** Registered marketplace discovery result. */
export interface AgentPluginsMarketplaceDiscoveryView {
  readonly candidates: readonly AgentPluginsMarketplaceCandidateView[]
  readonly diagnostics: readonly string[]
}

function diagnosticSummary(count: number): string {
  return `${count} diagnostic${count === 1 ? '' : 's'}; details are available in Host logs`
}

function projectInstallationDiagnostics(diagnostics: readonly string[]): readonly string[] {
  return diagnostics.length === 0 ? [] : [diagnosticSummary(diagnostics.length)]
}

function projectDiscoveryDiagnostics(diagnostics: readonly string[]): readonly string[] {
  const counts = new Map<string, number>()
  for (const diagnostic of diagnostics) {
    const source = /^([a-z][a-z0-9-]{0,63}):/iu.exec(diagnostic)?.[1] ?? 'plugin-bridge'
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  return [...counts].map(([source, count]) => `${source}: ${diagnosticSummary(count)}`)
}

function projectRequiredHosts(
  requirements: readonly { readonly kind: string; readonly host?: string }[],
): readonly string[] {
  return [...new Set(requirements
    .filter(requirement => requirement.kind === 'foreign-host' && requirement.host !== undefined)
    .map(requirement => requirement.host as string))].sort()
}

function classifyInstallFailure(error: unknown): AgentPluginsInstallFailureReason {
  if (typeof error === 'object' && error !== null && 'phase' in error
    && (error as { readonly phase?: unknown }).phase === 'activation') return 'activation'
  const message = error instanceof Error ? error.message : ''
  if (/timed?\s*out|timeout/iu.test(message)) return 'timeout'
  if (/already installed/iu.test(message)) return 'already-installed'
  if (/unsupported package format|has no components supported|not supported/iu.test(message)) return 'unsupported'
  if (/invalid (?:plugin )?manifest|manifest (?:is )?invalid|schema|parse|symlink|subdirectory|not a directory/iu.test(message)) {
    return 'invalid'
  }
  if (/\bgit\b|clone|checkout|fetch|download|network|ECONN|ENOTFOUND|HTTP/iu.test(message)) return 'source'
  return 'unknown'
}

/** Host gateway used by the Agent Plugins settings tab. */
export class AgentPluginsGateway extends TypertRemoteService {
  static inject = ['pluginBridgeRuntime']

  private mutationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'agentPluginsBridge')
  }

  private serializeMutation<T>(label: string, mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(async () => {
      try {
        return await mutation()
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error)
        this.ctx.logger.warn(`agentPluginsBridge ${label} failed: ${detail}`)
        throw error
      }
    })
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  /** @returns Current Bridge-owned marketplaces and installations. */
  @Remote('snapshot')
  snapshot(): AgentPluginsSnapshot {
    return {
      marketplaces: this.ctx.pluginBridgeRuntime.listMarketplaces().map(marketplace => ({
        name: marketplace.name,
        provider: marketplace.provider,
        plugins: marketplace.plugins.map(plugin => plugin.name),
      })),
      installations: this.ctx.pluginBridgeRuntime.listInstallations().map(installation => ({
        name: installation.name,
        marketplace: installation.marketplace,
        format: installation.format,
        enabled: installation.enabled,
        rowCount: installation.rows.length,
        protectedCount: installation.activations.length,
        requiredHosts: projectRequiredHosts(installation.requirements ?? []),
        unsupportedCount: installation.unsupported.length,
        diagnostics: projectInstallationDiagnostics(installation.diagnostics ?? []),
      })),
    }
  }

  /** @returns Foreign-agent plugin installations currently visible on the Host. */
  @Remote('discoverLocal')
  async discoverLocal(): Promise<AgentPluginsLocalDiscoveryView> {
    const discovery = await this.ctx.pluginBridgeRuntime.discoverLocalPlugins()
    return {
      candidates: discovery.candidates.map(candidate => ({
        ref: candidate.ref,
        locator: candidate.locator,
        name: candidate.name,
        evidence: candidate.evidence,
        ...(candidate.version === undefined ? {} : { version: candidate.version }),
        ...(candidate.marketplace === undefined ? {} : { marketplace: candidate.marketplace }),
        ...(candidate.scope === undefined ? {} : { scope: candidate.scope }),
        ...(candidate.enabled === undefined ? {} : { enabled: candidate.enabled }),
      })),
      diagnostics: projectDiscoveryDiagnostics(discovery.diagnostics),
    }
  }

  /** @returns Foreign-agent marketplace registrations currently visible on the Host. */
  @Remote('discoverMarketplaces')
  async discoverMarketplaces(): Promise<AgentPluginsMarketplaceDiscoveryView> {
    const discovery = await this.ctx.pluginBridgeRuntime.discoverRegisteredMarketplaces()
    return {
      candidates: discovery.candidates.map(candidate => ({
        ref: candidate.ref,
        locator: candidate.locator,
        name: candidate.name,
        sourceType: candidate.sourceType,
        ...(candidate.revision === undefined ? {} : { revision: candidate.revision }),
      })),
      diagnostics: projectDiscoveryDiagnostics(discovery.diagnostics),
    }
  }

  /** Add one marketplace location and return the updated durable view. */
  @Remote('addMarketplace')
  async addMarketplace(location: string): Promise<AgentPluginsSnapshot> {
    return this.serializeMutation(`addMarketplace ${location}`, async () => {
      await this.ctx.pluginBridgeRuntime.addMarketplace(location)
      return this.snapshot()
    })
  }

  /** Import one discovered foreign marketplace by its opaque ref. */
  @Remote('importMarketplace')
  async importMarketplace(ref: string): Promise<AgentPluginsSnapshot> {
    return this.serializeMutation(`importMarketplace ${ref}`, async () => {
      await this.ctx.pluginBridgeRuntime.importRegisteredMarketplace(ref)
      return this.snapshot()
    })
  }

  /** Import one discovered foreign plugin by its opaque ref. */
  @Remote('importLocal')
  async importLocal(ref: string): Promise<AgentPluginsSnapshot> {
    return this.serializeMutation(`importLocal ${ref}`, async () => {
      await this.ctx.pluginBridgeRuntime.importLocalPlugin(ref)
      return this.snapshot()
    })
  }

  /** Install a named plugin from one Bridge-owned marketplace. */
  @Remote('installPlugin')
  async installPlugin(name: string, marketplace: string): Promise<AgentPluginsInstallResult> {
    try {
      const snapshot = await this.serializeMutation(`installPlugin ${name}@${marketplace}`, async () => {
        await this.ctx.pluginBridgeRuntime.install(`${name}@${marketplace}`)
        return this.snapshot()
      })
      return { status: 'installed', snapshot }
    } catch (error: unknown) {
      return { status: 'failed', reason: classifyInstallFailure(error) }
    }
  }

  /** Enable or disable one Bridge-owned installation. */
  @Remote('setEnabled')
  async setEnabled(name: string, enabled: boolean): Promise<AgentPluginsSnapshot> {
    return this.serializeMutation(`setEnabled ${name}=${String(enabled)}`, async () => {
      if (enabled) await this.ctx.pluginBridgeRuntime.enable(name)
      else await this.ctx.pluginBridgeRuntime.disable(name)
      return this.snapshot()
    })
  }
}

export default AgentPluginsGateway
