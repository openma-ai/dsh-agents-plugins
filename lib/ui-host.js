var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
function diagnosticSummary(count) {
    return `${count} diagnostic${count === 1 ? '' : 's'}; details are available in Host logs`;
}
function projectInstallationDiagnostics(diagnostics) {
    return diagnostics.length === 0 ? [] : [diagnosticSummary(diagnostics.length)];
}
function projectDiscoveryDiagnostics(diagnostics) {
    const counts = new Map();
    for (const diagnostic of diagnostics) {
        const source = /^([a-z][a-z0-9-]{0,63}):/iu.exec(diagnostic)?.[1] ?? 'plugin-bridge';
        counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return [...counts].map(([source, count]) => `${source}: ${diagnosticSummary(count)}`);
}
function projectRequiredHosts(requirements) {
    return [...new Set(requirements
            .filter(requirement => requirement.kind === 'foreign-host' && requirement.host !== undefined)
            .map(requirement => requirement.host))].sort();
}
function classifyInstallFailure(error) {
    if (typeof error === 'object' && error !== null && 'phase' in error
        && error.phase === 'activation')
        return 'activation';
    const message = error instanceof Error ? error.message : '';
    if (/timed?\s*out|timeout/iu.test(message))
        return 'timeout';
    if (/already installed/iu.test(message))
        return 'already-installed';
    if (/unsupported package format|has no components supported|not supported/iu.test(message))
        return 'unsupported';
    if (/invalid (?:plugin )?manifest|manifest (?:is )?invalid|schema|parse|symlink|subdirectory|not a directory/iu.test(message)) {
        return 'invalid';
    }
    if (/\bgit\b|clone|checkout|fetch|download|network|ECONN|ENOTFOUND|HTTP/iu.test(message))
        return 'source';
    return 'unknown';
}
/** Host gateway used by the Agent Plugins settings tab. */
let AgentPluginsGateway = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _snapshot_decorators;
    let _discoverLocal_decorators;
    let _discoverMarketplaces_decorators;
    let _addMarketplace_decorators;
    let _importMarketplace_decorators;
    let _importLocal_decorators;
    let _installPlugin_decorators;
    let _setEnabled_decorators;
    let _piUpdates_decorators;
    let _checkPiUpdates_decorators;
    let _setPiUpdateMode_decorators;
    let _setPiPackageAutoUpdate_decorators;
    let _updatePiPackage_decorators;
    let _updateAllPiPackages_decorators;
    return class AgentPluginsGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _snapshot_decorators = [Remote('snapshot')];
            _discoverLocal_decorators = [Remote('discoverLocal')];
            _discoverMarketplaces_decorators = [Remote('discoverMarketplaces')];
            _addMarketplace_decorators = [Remote('addMarketplace')];
            _importMarketplace_decorators = [Remote('importMarketplace')];
            _importLocal_decorators = [Remote('importLocal')];
            _installPlugin_decorators = [Remote('installPlugin')];
            _setEnabled_decorators = [Remote('setEnabled')];
            _piUpdates_decorators = [Remote('piUpdates')];
            _checkPiUpdates_decorators = [Remote('checkPiUpdates')];
            _setPiUpdateMode_decorators = [Remote('setPiUpdateMode')];
            _setPiPackageAutoUpdate_decorators = [Remote('setPiPackageAutoUpdate')];
            _updatePiPackage_decorators = [Remote('updatePiPackage')];
            _updateAllPiPackages_decorators = [Remote('updateAllPiPackages')];
            __esDecorate(this, null, _snapshot_decorators, { kind: "method", name: "snapshot", static: false, private: false, access: { has: obj => "snapshot" in obj, get: obj => obj.snapshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _discoverLocal_decorators, { kind: "method", name: "discoverLocal", static: false, private: false, access: { has: obj => "discoverLocal" in obj, get: obj => obj.discoverLocal }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _discoverMarketplaces_decorators, { kind: "method", name: "discoverMarketplaces", static: false, private: false, access: { has: obj => "discoverMarketplaces" in obj, get: obj => obj.discoverMarketplaces }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _addMarketplace_decorators, { kind: "method", name: "addMarketplace", static: false, private: false, access: { has: obj => "addMarketplace" in obj, get: obj => obj.addMarketplace }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _importMarketplace_decorators, { kind: "method", name: "importMarketplace", static: false, private: false, access: { has: obj => "importMarketplace" in obj, get: obj => obj.importMarketplace }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _importLocal_decorators, { kind: "method", name: "importLocal", static: false, private: false, access: { has: obj => "importLocal" in obj, get: obj => obj.importLocal }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _installPlugin_decorators, { kind: "method", name: "installPlugin", static: false, private: false, access: { has: obj => "installPlugin" in obj, get: obj => obj.installPlugin }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setEnabled_decorators, { kind: "method", name: "setEnabled", static: false, private: false, access: { has: obj => "setEnabled" in obj, get: obj => obj.setEnabled }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _piUpdates_decorators, { kind: "method", name: "piUpdates", static: false, private: false, access: { has: obj => "piUpdates" in obj, get: obj => obj.piUpdates }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _checkPiUpdates_decorators, { kind: "method", name: "checkPiUpdates", static: false, private: false, access: { has: obj => "checkPiUpdates" in obj, get: obj => obj.checkPiUpdates }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setPiUpdateMode_decorators, { kind: "method", name: "setPiUpdateMode", static: false, private: false, access: { has: obj => "setPiUpdateMode" in obj, get: obj => obj.setPiUpdateMode }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setPiPackageAutoUpdate_decorators, { kind: "method", name: "setPiPackageAutoUpdate", static: false, private: false, access: { has: obj => "setPiPackageAutoUpdate" in obj, get: obj => obj.setPiPackageAutoUpdate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updatePiPackage_decorators, { kind: "method", name: "updatePiPackage", static: false, private: false, access: { has: obj => "updatePiPackage" in obj, get: obj => obj.updatePiPackage }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateAllPiPackages_decorators, { kind: "method", name: "updateAllPiPackages", static: false, private: false, access: { has: obj => "updateAllPiPackages" in obj, get: obj => obj.updateAllPiPackages }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['pluginBridgeRuntime'];
        mutationTail = (__runInitializers(this, _instanceExtraInitializers), Promise.resolve());
        constructor(ctx) {
            super(ctx, 'agentPluginsBridge');
        }
        serializeMutation(label, mutation) {
            const result = this.mutationTail.then(async () => {
                try {
                    return await mutation();
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    this.ctx.logger.warn(`agentPluginsBridge ${label} failed: ${detail}`);
                    throw error;
                }
            });
            this.mutationTail = result.then(() => undefined, () => undefined);
            return result;
        }
        async serializePiOperation(label, operation) {
            try {
                return await this.serializeMutation(label, operation);
            }
            catch {
                throw new Error('Pi package operation failed; check Host logs');
            }
        }
        /** @returns Current Bridge-owned marketplaces and installations. */
        snapshot() {
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
            };
        }
        /** @returns Foreign-agent plugin installations currently visible on the Host. */
        async discoverLocal() {
            const discovery = await this.ctx.pluginBridgeRuntime.discoverLocalPlugins();
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
            };
        }
        /** @returns Foreign-agent marketplace registrations currently visible on the Host. */
        async discoverMarketplaces() {
            const discovery = await this.ctx.pluginBridgeRuntime.discoverRegisteredMarketplaces();
            return {
                candidates: discovery.candidates.map(candidate => ({
                    ref: candidate.ref,
                    locator: candidate.locator,
                    name: candidate.name,
                    sourceType: candidate.sourceType,
                    ...(candidate.revision === undefined ? {} : { revision: candidate.revision }),
                })),
                diagnostics: projectDiscoveryDiagnostics(discovery.diagnostics),
            };
        }
        /** Add one marketplace location and return the updated durable view. */
        async addMarketplace(location) {
            return this.serializeMutation(`addMarketplace ${location}`, async () => {
                await this.ctx.pluginBridgeRuntime.addMarketplace(location);
                return this.snapshot();
            });
        }
        /** Import one discovered foreign marketplace by its opaque ref. */
        async importMarketplace(ref) {
            return this.serializeMutation(`importMarketplace ${ref}`, async () => {
                await this.ctx.pluginBridgeRuntime.importRegisteredMarketplace(ref);
                return this.snapshot();
            });
        }
        /** Import one discovered foreign plugin by its opaque ref. */
        async importLocal(ref) {
            return this.serializeMutation(`importLocal ${ref}`, async () => {
                await this.ctx.pluginBridgeRuntime.importLocalPlugin(ref);
                return this.snapshot();
            });
        }
        /** Install a named plugin from one Bridge-owned marketplace. */
        async installPlugin(name, marketplace) {
            try {
                const snapshot = await this.serializeMutation(`installPlugin ${name}@${marketplace}`, async () => {
                    await this.ctx.pluginBridgeRuntime.install(`${name}@${marketplace}`);
                    return this.snapshot();
                });
                return { status: 'installed', snapshot };
            }
            catch (error) {
                return { status: 'failed', reason: classifyInstallFailure(error) };
            }
        }
        /** Enable or disable one Bridge-owned installation. */
        async setEnabled(name, enabled) {
            return this.serializeMutation(`setEnabled ${name}=${String(enabled)}`, async () => {
                if (enabled)
                    await this.ctx.pluginBridgeRuntime.enable(name);
                else
                    await this.ctx.pluginBridgeRuntime.disable(name);
                return this.snapshot();
            });
        }
        /** Read Pi's persisted update policy and latest browser-safe check result. */
        piUpdates() {
            return this.ctx.pluginBridgeRuntime.piUpdateStatus();
        }
        /** Ask Pi's native package manager to check for updates now. */
        checkPiUpdates() {
            return this.serializePiOperation('checkPiUpdates', () => this.ctx.pluginBridgeRuntime.checkPiUpdates());
        }
        /** Change the global Pi update lifecycle policy. */
        setPiUpdateMode(mode) {
            return this.serializePiOperation(`setPiUpdateMode ${mode}`, () => (this.ctx.pluginBridgeRuntime.setPiUpdateMode(mode)));
        }
        /** Include or exclude one Pi package from automatic updates. */
        setPiPackageAutoUpdate(id, enabled) {
            return this.serializePiOperation(`setPiPackageAutoUpdate ${id}=${String(enabled)}`, () => (this.ctx.pluginBridgeRuntime.setPiPackageAutoUpdate(id, enabled)));
        }
        /** Apply one available update with Pi's native package manager. */
        updatePiPackage(id) {
            return this.serializePiOperation(`updatePiPackage ${id}`, () => this.ctx.pluginBridgeRuntime.updatePiPackage(id));
        }
        /** Apply all currently available imported-package updates with Pi. */
        updateAllPiPackages() {
            return this.serializePiOperation('updateAllPiPackages', () => this.ctx.pluginBridgeRuntime.updateAllPiPackages());
        }
    };
})();
export { AgentPluginsGateway };
export default AgentPluginsGateway;
//# sourceMappingURL=ui-host.js.map