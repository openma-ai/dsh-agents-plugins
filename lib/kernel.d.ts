import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { MarketplaceCatalogObservation, MarketplaceCatalogProvider, MarketplaceCatalogSource } from './marketplaces/types.js';
/** Read-only view of one extracted plugin package. Paths are plugin-root relative. */
export type PluginPackageEntryKind = 'file' | 'directory' | 'other';
export interface PluginPackageSource {
    readonly root: string;
    has(path: string): boolean;
    kind(path: string): PluginPackageEntryKind | undefined;
    readJson(path: string): unknown;
    /** Exact file bytes decoded as UTF-8 when the backing source exposes them. */
    readText?(path: string): string;
}
/** Format-specific metadata returned after a provider claims one package. */
export interface PackageFormatObservation {
    readonly manifestPath: string;
    readonly manifest: Readonly<Record<string, unknown>>;
    readonly components: readonly PackageComponent[];
    readonly diagnostics?: readonly string[];
}
/** One component discovered at a format-owned package location. */
export interface PackageComponent {
    readonly type: string;
    readonly path: string;
    /** Manifest field when the component is declared inline rather than in its own file. */
    readonly manifestField?: string;
}
/** Recognizes an extracted package dialect without installing or executing it. */
export interface PackageFormatProvider {
    readonly name: string;
    probe(source: PluginPackageSource): PackageFormatObservation | undefined;
}
/** Marketplace discovery seam; concrete providers own their source dialect. */
export interface MarketplaceProvider extends MarketplaceCatalogProvider {
}
/** One foreign installation/cache entry that can be copied into bridge storage. */
export interface InstalledPluginCandidate {
    /** Locator-local stable key. It must not contain whitespace. */
    readonly key: string;
    readonly name: string;
    readonly root: string;
    readonly evidence: 'installed-registry' | 'plugin-cache';
    readonly version?: string;
    readonly marketplace?: string;
    readonly scope?: string;
    readonly enabled?: boolean;
    readonly diagnostics?: readonly string[];
}
/** Isolated result from one installed-plugin locator. */
export interface InstalledPluginLocatorObservation {
    readonly candidates: readonly InstalledPluginCandidate[];
    readonly diagnostics?: readonly string[];
}
/** Read-only discovery provider for one foreign agent's local plugin state. */
export interface InstalledPluginLocator {
    readonly name: string;
    discover(): Promise<InstalledPluginLocatorObservation>;
}
/** One marketplace registration observed in a foreign agent's local state. */
export interface MarketplaceRegistrationCandidate {
    readonly key: string;
    readonly name: string;
    /** Local catalog checkout, repository URL, or supported manager location. */
    readonly location: string;
    readonly sourceType: 'local' | 'git' | 'installed-checkout';
    readonly revision?: string;
    readonly diagnostics?: readonly string[];
}
export interface MarketplaceRegistrationLocatorObservation {
    readonly candidates: readonly MarketplaceRegistrationCandidate[];
    readonly diagnostics?: readonly string[];
}
/** Read-only discovery provider for one foreign agent's registered marketplaces. */
export interface MarketplaceRegistrationLocator {
    readonly name: string;
    discover(): Promise<MarketplaceRegistrationLocatorObservation>;
}
/** Successful marketplace detection, including its claiming provider. */
export interface DetectedMarketplaceCatalog extends MarketplaceCatalogObservation {
    readonly provider: string;
}
/** One Loader entry produced for a normalized foreign-plugin component. */
export interface DshPluginRow {
    readonly id: string;
    readonly name: string;
    readonly config?: Readonly<Record<string, unknown>>;
}
/** Input shared by component adapters while compiling one package. */
export interface ComponentMaterializationInput {
    readonly source: PluginPackageSource;
    readonly detected: DetectedPackageFormat;
    readonly component: PackageComponent;
    /** Client-managed persistent directory for this installed plugin instance. */
    readonly pluginDataRoot?: string;
}
/** Installation-scoped paths available while compiling normalized components. */
export interface PackageMaterializationOptions {
    readonly pluginDataRoot?: string;
}
/** Maps one normalized component type onto one or more dsh Cordis rows. */
export interface ComponentAdapter {
    readonly name: string;
    readonly componentTypes: readonly string[];
    materialize(input: ComponentMaterializationInput): readonly DshPluginRow[] | ComponentAdapterMaterialization;
}
/** Rows and entry-local diagnostics returned by one capability adapter. */
export interface ComponentAdapterMaterialization {
    readonly rows: readonly DshPluginRow[];
    readonly diagnostics?: readonly string[];
    /** Optional execution gates owned by separately registered activation policies. */
    readonly activations?: readonly ActivationRequirement[];
}
/** One row-level execution gate contributed by a capability adapter. */
export interface ActivationRequirement {
    readonly policy: string;
    readonly rowId: string;
    /** Digest of the exact component definition that was inspected. */
    readonly digest: string;
    /** Policy-owned, serializable evidence needed to re-inspect the component. */
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Current policy result used for review and activation decisions. */
export interface ActivationInspection extends ActivationRequirement {
    readonly review: string;
}
/** Re-inspects one gated row without teaching the kernel component semantics. */
export interface ActivationPolicy {
    readonly name: string;
    inspect(requirement: ActivationRequirement): Promise<ActivationInspection>;
}
/** Complete row plan plus components for which dsh has no registered adapter. */
export interface PackageMaterialization {
    readonly rows: readonly DshPluginRow[];
    readonly activations: readonly ActivationRequirement[];
    readonly unsupported: readonly PackageComponent[];
    readonly diagnostics?: readonly string[];
}
/** Successful package detection, including the exact provider that claimed it. */
export interface DetectedPackageFormat extends PackageFormatObservation {
    readonly provider: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        pluginBridge: PluginBridgeKernel;
    }
}
/** Shared bridge kernel. Platform support is contributed through reversible providers. */
export declare class PluginBridgeKernel extends Service {
    private readonly marketplaceProviders;
    private readonly packageFormatProviders;
    private readonly componentAdapters;
    private readonly installedPluginLocators;
    private readonly marketplaceRegistrationLocators;
    private readonly activationPolicies;
    constructor(ctx: Context);
    registerMarketplaceProvider(provider: MarketplaceProvider): () => void;
    registerPackageFormatProvider(provider: PackageFormatProvider): () => void;
    registerComponentAdapter(adapter: ComponentAdapter): () => void;
    registerInstalledPluginLocator(locator: InstalledPluginLocator): () => void;
    registerMarketplaceRegistrationLocator(locator: MarketplaceRegistrationLocator): () => void;
    registerActivationPolicy(policy: ActivationPolicy): () => void;
    listMarketplaceProviders(): readonly MarketplaceProvider[];
    listPackageFormatProviders(): readonly PackageFormatProvider[];
    listComponentAdapters(): readonly ComponentAdapter[];
    listInstalledPluginLocators(): readonly InstalledPluginLocator[];
    listMarketplaceRegistrationLocators(): readonly MarketplaceRegistrationLocator[];
    listActivationPolicies(): readonly ActivationPolicy[];
    getActivationPolicy(name: string): ActivationPolicy | undefined;
    /** Detect one already-loaded marketplace catalog without guessing its dialect. */
    detectMarketplaceCatalog(source: MarketplaceCatalogSource): DetectedMarketplaceCatalog;
    detectPackageFormat(source: PluginPackageSource): DetectedPackageFormat;
    /** Compile every normalized component through exactly one registered adapter. */
    materializePackage(source: PluginPackageSource, detected: DetectedPackageFormat, options?: PackageMaterializationOptions): PackageMaterialization;
    private register;
    private sorted;
}
export default PluginBridgeKernel;
//# sourceMappingURL=kernel.d.ts.map