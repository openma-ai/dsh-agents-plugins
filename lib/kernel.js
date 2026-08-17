import { Service } from '@deepseek-ai/cordis';
function isAdapterMaterialization(value) {
    return !Array.isArray(value);
}
/** Shared bridge kernel. Platform support is contributed through reversible providers. */
export class PluginBridgeKernel extends Service {
    marketplaceProviders = new Map();
    packageFormatProviders = new Map();
    componentAdapters = new Map();
    installedPluginLocators = new Map();
    marketplaceRegistrationLocators = new Map();
    activationPolicies = new Map();
    constructor(ctx) {
        super(ctx, 'pluginBridge');
    }
    registerMarketplaceProvider(provider) {
        if (typeof provider.probe !== 'function') {
            throw new TypeError(`marketplace provider "${provider.name}" must define probe()`);
        }
        return this.register(this.marketplaceProviders, provider, 'marketplace provider');
    }
    registerPackageFormatProvider(provider) {
        if (typeof provider.probe !== 'function') {
            throw new TypeError(`package format provider "${provider.name}" must define probe()`);
        }
        return this.register(this.packageFormatProviders, provider, 'package format provider');
    }
    registerComponentAdapter(adapter) {
        if (!Array.isArray(adapter.componentTypes) || adapter.componentTypes.length === 0) {
            throw new TypeError(`component adapter "${adapter.name}" must declare at least one component type`);
        }
        if (typeof adapter.materialize !== 'function') {
            throw new TypeError(`component adapter "${adapter.name}" must define materialize()`);
        }
        return this.register(this.componentAdapters, adapter, 'component adapter');
    }
    registerInstalledPluginLocator(locator) {
        if (typeof locator.discover !== 'function') {
            throw new TypeError(`installed-plugin locator "${locator.name}" must define discover()`);
        }
        return this.register(this.installedPluginLocators, locator, 'installed-plugin locator');
    }
    registerMarketplaceRegistrationLocator(locator) {
        if (typeof locator.discover !== 'function') {
            throw new TypeError(`marketplace-registration locator "${locator.name}" must define discover()`);
        }
        return this.register(this.marketplaceRegistrationLocators, locator, 'marketplace-registration locator');
    }
    registerActivationPolicy(policy) {
        if (typeof policy.inspect !== 'function') {
            throw new TypeError(`activation policy "${policy.name}" must define inspect()`);
        }
        return this.register(this.activationPolicies, policy, 'activation policy');
    }
    listMarketplaceProviders() {
        return this.sorted(this.marketplaceProviders);
    }
    listPackageFormatProviders() {
        return this.sorted(this.packageFormatProviders);
    }
    listComponentAdapters() {
        return this.sorted(this.componentAdapters);
    }
    listInstalledPluginLocators() {
        return this.sorted(this.installedPluginLocators);
    }
    listMarketplaceRegistrationLocators() {
        return this.sorted(this.marketplaceRegistrationLocators);
    }
    listActivationPolicies() {
        return this.sorted(this.activationPolicies);
    }
    getActivationPolicy(name) {
        return this.activationPolicies.get(name);
    }
    /** Detect one already-loaded marketplace catalog without guessing its dialect. */
    detectMarketplaceCatalog(source) {
        const matches = [];
        for (const provider of this.listMarketplaceProviders()) {
            const observation = provider.probe(source);
            if (observation !== undefined)
                matches.push({ provider: provider.name, ...observation });
        }
        if (matches.length === 0) {
            throw new Error(`unsupported marketplace catalog at "${source.manifestPath}"`);
        }
        if (matches.length > 1) {
            throw new Error(`ambiguous marketplace catalog: ${matches.map(match => match.provider).join(', ')}`);
        }
        return matches[0];
    }
    detectPackageFormat(source) {
        const matches = [];
        for (const provider of this.listPackageFormatProviders()) {
            const observation = provider.probe(source);
            if (observation !== undefined)
                matches.push({ provider: provider.name, ...observation });
        }
        if (matches.length === 0) {
            throw new Error(`unsupported package format at "${source.root}"`);
        }
        if (matches.length > 1) {
            throw new Error(`ambiguous package format: ${matches.map(match => match.provider).join(', ')}`);
        }
        // The empty case returned above, and the ambiguous case proves this exact slot exists.
        return matches[0];
    }
    /** Compile every normalized component through exactly one registered adapter. */
    materializePackage(source, detected, options = {}) {
        const adapters = this.listComponentAdapters();
        const rows = [];
        const unsupported = [];
        const diagnostics = [...(detected.diagnostics ?? [])];
        const activations = [];
        const rowIds = new Set();
        const activationRowIds = new Set();
        for (const component of detected.components) {
            const matches = adapters.filter(adapter => adapter.componentTypes.includes(component.type));
            if (matches.length === 0) {
                unsupported.push(component);
                continue;
            }
            if (matches.length > 1) {
                throw new Error(`component "${component.type}" is claimed by multiple adapters: ${matches.map(adapter => adapter.name).join(', ')}`);
            }
            const adapter = matches[0];
            const output = adapter.materialize({
                source,
                detected,
                component,
                ...options.pluginDataRoot === undefined ? {} : { pluginDataRoot: options.pluginDataRoot },
            });
            const produced = isAdapterMaterialization(output) ? output.rows : output;
            if (isAdapterMaterialization(output) && output.diagnostics !== undefined) {
                diagnostics.push(...output.diagnostics);
            }
            for (const row of produced) {
                if (rowIds.has(row.id)) {
                    throw new Error(`component materialization produced duplicate row id "${row.id}"`);
                }
                rowIds.add(row.id);
                rows.push(Object.freeze({ ...row }));
            }
            if (isAdapterMaterialization(output) && output.activations !== undefined) {
                for (const activation of output.activations) {
                    if (!produced.some(row => row.id === activation.rowId)) {
                        throw new Error(`component adapter "${adapter.name}" gated unknown row id "${activation.rowId}"`);
                    }
                    if (activationRowIds.has(activation.rowId)) {
                        throw new Error(`component materialization gated row "${activation.rowId}" more than once`);
                    }
                    activationRowIds.add(activation.rowId);
                    activations.push(Object.freeze(structuredClone(activation)));
                }
            }
        }
        return Object.freeze({
            rows: Object.freeze(rows),
            activations: Object.freeze(activations),
            unsupported: Object.freeze(unsupported),
            ...diagnostics.length === 0 ? {} : { diagnostics: Object.freeze(diagnostics) },
        });
    }
    register(registry, contribution, kind) {
        const contributionName = contribution.name;
        if (typeof contributionName !== 'string' || contributionName.trim().length === 0) {
            throw new TypeError(`${kind} name must be a non-empty string`);
        }
        return this.ctx.effect(() => {
            if (registry.has(contributionName)) {
                throw new Error(`${kind} "${contributionName}" is already registered`);
            }
            registry.set(contributionName, contribution);
            return () => {
                if (registry.get(contributionName) === contribution)
                    registry.delete(contributionName);
            };
        }, `pluginBridge.register(${kind}:${contributionName})`);
    }
    sorted(registry) {
        return [...registry.values()].sort((left, right) => compareCodePoints(left.name, right.name));
    }
}
function compareCodePoints(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
export default PluginBridgeKernel;
//# sourceMappingURL=kernel.js.map