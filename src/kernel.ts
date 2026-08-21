import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  MarketplaceCatalogObservation,
  MarketplaceCatalogProvider,
  MarketplaceCatalogSource,
} from './marketplaces/types.js'

/** Read-only view of one extracted plugin package. Paths are plugin-root relative. */
export type PluginPackageEntryKind = 'file' | 'directory' | 'other'

export interface PluginPackageSource {
  readonly root: string
  has(path: string): boolean
  kind(path: string): PluginPackageEntryKind | undefined
  readJson(path: string): unknown
  /** Exact file bytes decoded as UTF-8 when the backing source exposes them. */
  readText?(path: string): string
}

/** Format-specific metadata returned after a provider claims one package. */
export interface PackageFormatObservation {
  readonly manifestPath: string
  readonly manifest: Readonly<Record<string, unknown>>
  readonly components: readonly PackageComponent[]
  readonly diagnostics?: readonly string[]
}

/** One component discovered at a format-owned package location. */
export interface PackageComponent {
  readonly type: string
  readonly path: string
  /** Manifest field when the component is declared inline rather than in its own file. */
  readonly manifestField?: string
  /** Format-owned, JSON-safe component data consumed only by its matching adapter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Recognizes an extracted package dialect without installing or executing it. */
export interface PackageFormatProvider {
  readonly name: string
  probe(source: PluginPackageSource): PackageFormatObservation | undefined
}

/** Marketplace discovery seam; concrete providers own their source dialect. */
export interface MarketplaceProvider extends MarketplaceCatalogProvider {}

/** One foreign installation/cache entry that can be copied into bridge storage. */
export interface InstalledPluginCandidate {
  /** Locator-local stable key. It must not contain whitespace. */
  readonly key: string
  readonly name: string
  readonly root: string
  readonly evidence: 'installed-registry' | 'plugin-cache'
  readonly version?: string
  readonly marketplace?: string
  readonly scope?: string
  /** Exact package-manager source, retained Host-side for native lifecycle operations. */
  readonly upstreamSource?: string
  readonly enabled?: boolean
  readonly diagnostics?: readonly string[]
}

/** Isolated result from one installed-plugin locator. */
export interface InstalledPluginLocatorObservation {
  readonly candidates: readonly InstalledPluginCandidate[]
  readonly diagnostics?: readonly string[]
}

/** Read-only discovery provider for one foreign agent's local plugin state. */
export interface InstalledPluginLocator {
  readonly name: string
  discover(): Promise<InstalledPluginLocatorObservation>
}

/** One marketplace registration observed in a foreign agent's local state. */
export interface MarketplaceRegistrationCandidate {
  readonly key: string
  readonly name: string
  /** Local catalog checkout, repository URL, or supported manager location. */
  readonly location: string
  readonly sourceType: 'local' | 'git' | 'installed-checkout'
  readonly revision?: string
  readonly diagnostics?: readonly string[]
}

export interface MarketplaceRegistrationLocatorObservation {
  readonly candidates: readonly MarketplaceRegistrationCandidate[]
  readonly diagnostics?: readonly string[]
}

/** Read-only discovery provider for one foreign agent's registered marketplaces. */
export interface MarketplaceRegistrationLocator {
  readonly name: string
  discover(): Promise<MarketplaceRegistrationLocatorObservation>
}

/** Successful marketplace detection, including its claiming provider. */
export interface DetectedMarketplaceCatalog extends MarketplaceCatalogObservation {
  readonly provider: string
}

/** One Loader entry produced for a normalized foreign-plugin component. */
export interface DshPluginRow {
  readonly id: string
  readonly name: string
  readonly config?: Readonly<Record<string, unknown>>
}

/** Input shared by component adapters while compiling one package. */
export interface ComponentMaterializationInput {
  readonly source: PluginPackageSource
  readonly detected: DetectedPackageFormat
  readonly component: PackageComponent
  /** Client-managed persistent directory for this installed plugin instance. */
  readonly pluginDataRoot?: string
}

/** Installation-scoped paths available while compiling normalized components. */
export interface PackageMaterializationOptions {
  readonly pluginDataRoot?: string
}

/** Maps one normalized component type onto one or more dsh Cordis rows. */
export interface ComponentAdapter {
  readonly name: string
  readonly componentTypes: readonly string[]
  materialize(
    input: ComponentMaterializationInput,
  ): readonly DshPluginRow[] | ComponentAdapterMaterialization
}

/** Rows and entry-local diagnostics returned by one capability adapter. */
export interface ComponentAdapterMaterialization {
  readonly rows: readonly DshPluginRow[]
  readonly diagnostics?: readonly string[]
  /** Runtime dependencies recognized by an adapter but fulfilled by another host. */
  readonly requirements?: readonly RuntimeRequirement[]
  /** Optional execution gates owned by separately registered activation policies. */
  readonly activations?: readonly ActivationRequirement[]
}

/** One recognized capability that remains dependent on a foreign runtime host. */
export interface RuntimeRequirement {
  readonly kind: 'foreign-host'
  readonly host: string
  readonly capability: string
  readonly componentPath: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** One row-level execution gate contributed by a capability adapter. */
export interface ActivationRequirement {
  readonly policy: string
  readonly rowId: string
  /** Digest of the exact component definition that was inspected. */
  readonly digest: string
  /** Policy-owned, serializable evidence needed to re-inspect the component. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Current policy result used for review and activation decisions. */
export interface ActivationInspection extends ActivationRequirement {
  readonly review: string
}

/** Re-inspects one gated row without teaching the kernel component semantics. */
export interface ActivationPolicy {
  readonly name: string
  inspect(requirement: ActivationRequirement): Promise<ActivationInspection>
}

/** Complete row plan plus components for which dsh has no registered adapter. */
export interface PackageMaterialization {
  readonly rows: readonly DshPluginRow[]
  readonly activations: readonly ActivationRequirement[]
  readonly requirements: readonly RuntimeRequirement[]
  readonly unsupported: readonly PackageComponent[]
  readonly diagnostics?: readonly string[]
}

/** Successful package detection, including the exact provider that claimed it. */
export interface DetectedPackageFormat extends PackageFormatObservation {
  readonly provider: string
}

function isAdapterMaterialization(
  value: readonly DshPluginRow[] | ComponentAdapterMaterialization,
): value is ComponentAdapterMaterialization {
  return !Array.isArray(value)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginBridge: PluginBridgeKernel
  }
}

/** Shared bridge kernel. Platform support is contributed through reversible providers. */
export class PluginBridgeKernel extends Service {
  private readonly marketplaceProviders = new Map<string, MarketplaceProvider>()
  private readonly packageFormatProviders = new Map<string, PackageFormatProvider>()
  private readonly componentAdapters = new Map<string, ComponentAdapter>()
  private readonly installedPluginLocators = new Map<string, InstalledPluginLocator>()
  private readonly marketplaceRegistrationLocators = new Map<string, MarketplaceRegistrationLocator>()
  private readonly activationPolicies = new Map<string, ActivationPolicy>()

  constructor(ctx: Context) {
    super(ctx, 'pluginBridge')
  }

  registerMarketplaceProvider(provider: MarketplaceProvider): () => void {
    if (typeof provider.probe !== 'function') {
      throw new TypeError(`marketplace provider "${provider.name}" must define probe()`)
    }
    return this.register(this.marketplaceProviders, provider, 'marketplace provider')
  }

  registerPackageFormatProvider(provider: PackageFormatProvider): () => void {
    if (typeof provider.probe !== 'function') {
      throw new TypeError(`package format provider "${provider.name}" must define probe()`)
    }
    return this.register(this.packageFormatProviders, provider, 'package format provider')
  }

  registerComponentAdapter(adapter: ComponentAdapter): () => void {
    if (!Array.isArray(adapter.componentTypes) || adapter.componentTypes.length === 0) {
      throw new TypeError(`component adapter "${adapter.name}" must declare at least one component type`)
    }
    if (typeof adapter.materialize !== 'function') {
      throw new TypeError(`component adapter "${adapter.name}" must define materialize()`)
    }
    return this.register(this.componentAdapters, adapter, 'component adapter')
  }

  registerInstalledPluginLocator(locator: InstalledPluginLocator): () => void {
    if (typeof locator.discover !== 'function') {
      throw new TypeError(`installed-plugin locator "${locator.name}" must define discover()`)
    }
    return this.register(this.installedPluginLocators, locator, 'installed-plugin locator')
  }

  registerMarketplaceRegistrationLocator(locator: MarketplaceRegistrationLocator): () => void {
    if (typeof locator.discover !== 'function') {
      throw new TypeError(`marketplace-registration locator "${locator.name}" must define discover()`)
    }
    return this.register(
      this.marketplaceRegistrationLocators,
      locator,
      'marketplace-registration locator',
    )
  }

  registerActivationPolicy(policy: ActivationPolicy): () => void {
    if (typeof policy.inspect !== 'function') {
      throw new TypeError(`activation policy "${policy.name}" must define inspect()`)
    }
    return this.register(this.activationPolicies, policy, 'activation policy')
  }

  listMarketplaceProviders(): readonly MarketplaceProvider[] {
    return this.sorted(this.marketplaceProviders)
  }

  listPackageFormatProviders(): readonly PackageFormatProvider[] {
    return this.sorted(this.packageFormatProviders)
  }

  listComponentAdapters(): readonly ComponentAdapter[] {
    return this.sorted(this.componentAdapters)
  }

  listInstalledPluginLocators(): readonly InstalledPluginLocator[] {
    return this.sorted(this.installedPluginLocators)
  }

  listMarketplaceRegistrationLocators(): readonly MarketplaceRegistrationLocator[] {
    return this.sorted(this.marketplaceRegistrationLocators)
  }

  listActivationPolicies(): readonly ActivationPolicy[] {
    return this.sorted(this.activationPolicies)
  }

  getActivationPolicy(name: string): ActivationPolicy | undefined {
    return this.activationPolicies.get(name)
  }

  /** Detect one already-loaded marketplace catalog without guessing its dialect. */
  detectMarketplaceCatalog(source: MarketplaceCatalogSource): DetectedMarketplaceCatalog {
    const matches: DetectedMarketplaceCatalog[] = []
    for (const provider of this.listMarketplaceProviders()) {
      const observation = provider.probe(source)
      if (observation !== undefined) matches.push({ provider: provider.name, ...observation })
    }
    if (matches.length === 0) {
      throw new Error(`unsupported marketplace catalog at "${source.manifestPath}"`)
    }
    if (matches.length > 1) {
      throw new Error(`ambiguous marketplace catalog: ${matches.map(match => match.provider).join(', ')}`)
    }
    return matches[0] as DetectedMarketplaceCatalog
  }

  detectPackageFormat(source: PluginPackageSource): DetectedPackageFormat {
    const matches: DetectedPackageFormat[] = []
    for (const provider of this.listPackageFormatProviders()) {
      const observation = provider.probe(source)
      if (observation !== undefined) matches.push({ provider: provider.name, ...observation })
    }
    if (matches.length === 0) {
      throw new Error(`unsupported package format at "${source.root}"`)
    }
    if (matches.length > 1) {
      throw new Error(`ambiguous package format: ${matches.map(match => match.provider).join(', ')}`)
    }
    // The empty case returned above, and the ambiguous case proves this exact slot exists.
    return matches[0] as DetectedPackageFormat
  }

  /** Compile every normalized component through exactly one registered adapter. */
  materializePackage(
    source: PluginPackageSource,
    detected: DetectedPackageFormat,
    options: PackageMaterializationOptions = {},
  ): PackageMaterialization {
    const adapters = this.listComponentAdapters()
    const rows: DshPluginRow[] = []
    const unsupported: PackageComponent[] = []
    const diagnostics = [...(detected.diagnostics ?? [])]
    const activations: ActivationRequirement[] = []
    const requirements: RuntimeRequirement[] = []
    const rowIds = new Set<string>()
    const activationRowIds = new Set<string>()
    for (const component of detected.components) {
      const matches = adapters.filter(adapter => adapter.componentTypes.includes(component.type))
      if (matches.length === 0) {
        unsupported.push(component)
        continue
      }
      if (matches.length > 1) {
        throw new Error(
          `component "${component.type}" is claimed by multiple adapters: ${matches.map(adapter => adapter.name).join(', ')}`,
        )
      }
      const adapter = matches[0] as ComponentAdapter
      const output = adapter.materialize({
        source,
        detected,
        component,
        ...options.pluginDataRoot === undefined ? {} : { pluginDataRoot: options.pluginDataRoot },
      })
      const produced = isAdapterMaterialization(output) ? output.rows : output
      if (isAdapterMaterialization(output) && output.diagnostics !== undefined) {
        diagnostics.push(...output.diagnostics)
      }
      if (isAdapterMaterialization(output) && output.requirements !== undefined) {
        requirements.push(...output.requirements.map(requirement => (
          Object.freeze(structuredClone(requirement))
        )))
      }
      for (const row of produced) {
        if (rowIds.has(row.id)) {
          throw new Error(`component materialization produced duplicate row id "${row.id}"`)
        }
        rowIds.add(row.id)
        rows.push(Object.freeze({ ...row }))
      }
      if (isAdapterMaterialization(output) && output.activations !== undefined) {
        for (const activation of output.activations) {
          if (!produced.some(row => row.id === activation.rowId)) {
            throw new Error(
              `component adapter "${adapter.name}" gated unknown row id "${activation.rowId}"`,
            )
          }
          if (activationRowIds.has(activation.rowId)) {
            throw new Error(`component materialization gated row "${activation.rowId}" more than once`)
          }
          activationRowIds.add(activation.rowId)
          activations.push(Object.freeze(structuredClone(activation)))
        }
      }
    }
    return Object.freeze({
      rows: Object.freeze(rows),
      activations: Object.freeze(activations),
      requirements: Object.freeze(requirements),
      unsupported: Object.freeze(unsupported),
      ...diagnostics.length === 0 ? {} : { diagnostics: Object.freeze(diagnostics) },
    })
  }

  private register<T extends { readonly name: string }>(
    registry: Map<string, T>,
    contribution: T,
    kind: string,
  ): () => void {
    const contributionName = contribution.name
    if (typeof contributionName !== 'string' || contributionName.trim().length === 0) {
      throw new TypeError(`${kind} name must be a non-empty string`)
    }
    return this.ctx.effect(() => {
      if (registry.has(contributionName)) {
        throw new Error(`${kind} "${contributionName}" is already registered`)
      }
      registry.set(contributionName, contribution)
      return () => {
        if (registry.get(contributionName) === contribution) registry.delete(contributionName)
      }
    }, `pluginBridge.register(${kind}:${contributionName})`)
  }

  private sorted<T extends { readonly name: string }>(registry: Map<string, T>): readonly T[] {
    return [...registry.values()].sort((left, right) => compareCodePoints(left.name, right.name))
  }
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export default PluginBridgeKernel
