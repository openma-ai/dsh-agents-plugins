import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import { PluginBridgeManager, } from './manager.js';
import { PiUpdateController, createPiNativePackageManager, } from './pi-updates.js';
/** Select native Pi package identities from durable Bridge imports. */
export function listImportedPiPackages(installations) {
    const imported = [];
    for (const installation of installations) {
        const source = installation.source;
        if (source?.upstreamSource === undefined)
            continue;
        if (source.locator === 'pi-installed-user') {
            imported.push({ source: source.upstreamSource, scope: 'user' });
        }
        else if (source.locator === 'pi-installed-project') {
            imported.push({ source: source.upstreamSource, scope: 'project' });
        }
    }
    return imported;
}
export const name = 'plugin-bridge-runtime';
export const inject = ['pluginBridge', 'loader'];
/** Start best-effort reconciliation and return its lifecycle cleanup. */
export function startPluginAutoUpdates(sync, intervalMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new TypeError('plugin auto-update interval must be a positive finite number');
    }
    let stopped = false;
    let inFlight;
    const tick = () => {
        if (stopped || inFlight !== undefined)
            return;
        const task = Promise.resolve().then(sync).catch(() => {
            // The runtime callback owns diagnostics; the scheduler only prevents an unhandled rejection.
        });
        inFlight = task;
        void task.then(() => {
            if (inFlight === task)
                inFlight = undefined;
        });
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return async () => {
        stopped = true;
        clearInterval(timer);
        await inFlight;
    };
}
/** Cordis service facade over the persistent marketplace and installation manager. */
export class PluginBridgeRuntime extends Service {
    manager;
    piUpdates;
    constructor(ctx, config = {}) {
        super(ctx, 'pluginBridgeRuntime');
        const loader = ctx.get('loader');
        if (loader === undefined)
            throw new Error('plugin-bridge-runtime: Loader service is unavailable');
        const bridgeLoader = {
            create: row => loader.create(row),
            remove: id => loader.remove(id),
        };
        const storageDir = config.storageDir
            ?? fileURLToPath(new URL('.plugin-bridge/', ctx.baseUrl ?? new URL('.', import.meta.url).href));
        this.manager = new PluginBridgeManager(ctx.pluginBridge, bridgeLoader, storageDir);
        const piCheckInterval = config.piUpdateCheckIntervalMs === undefined || config.piUpdateCheckIntervalMs === 0
            ? 6 * 60 * 60 * 1_000
            : config.piUpdateCheckIntervalMs;
        this.piUpdates = new PiUpdateController({
            storageDir,
            nativeManager: createPiNativePackageManager(config.piCwd ?? process.cwd()),
            listImportedPackages: () => listImportedPiPackages(this.manager.listInstallations()),
            reconcile: async () => { await this.manager.syncImportedPlugins(); },
            checkIntervalMs: piCheckInterval,
        });
    }
    async start() {
        await this.manager.start();
        try {
            // Reconcile first so legacy imports acquire their native source identity
            // before Pi's initial update check filters the imported package set.
            await this.manager.syncImportedPlugins();
            await this.piUpdates.start();
        }
        catch (error) {
            await this.manager.dispose();
            throw error;
        }
    }
    listMarketplaces() {
        return this.manager.listMarketplaces();
    }
    listInstallations() {
        return this.manager.listInstallations();
    }
    addMarketplace(location) {
        return this.manager.addMarketplace(location);
    }
    install(spec) {
        return this.manager.install(spec);
    }
    discoverLocalPlugins() {
        return this.manager.discoverLocalPlugins();
    }
    importLocalPlugin(ref) {
        return this.manager.importLocalPlugin(ref);
    }
    syncImportedPlugins() {
        return this.manager.syncImportedPlugins();
    }
    piUpdateStatus() {
        return this.piUpdates.status();
    }
    checkPiUpdates() {
        return this.piUpdates.checkNow();
    }
    runScheduledPiUpdateCheck() {
        return this.piUpdates.runScheduledCheck();
    }
    setPiUpdateMode(mode) {
        return this.piUpdates.setMode(mode);
    }
    setPiPackageAutoUpdate(id, enabled) {
        return this.piUpdates.setPackageAutoUpdate(id, enabled);
    }
    updatePiPackage(id) {
        return this.piUpdates.updatePackage(id);
    }
    updateAllPiPackages() {
        return this.piUpdates.updateAll();
    }
    discoverRegisteredMarketplaces() {
        return this.manager.discoverRegisteredMarketplaces();
    }
    importRegisteredMarketplace(ref) {
        return this.manager.importRegisteredMarketplace(ref);
    }
    reviewActivations(policy, plugin) {
        return this.manager.reviewActivations(policy, plugin);
    }
    approveActivation(policy, plugin, digest) {
        return this.manager.approveActivation(policy, plugin, digest);
    }
    disable(pluginName) {
        return this.manager.disable(pluginName);
    }
    enable(pluginName) {
        return this.manager.enable(pluginName);
    }
    uninstall(pluginName) {
        return this.manager.uninstall(pluginName);
    }
    dispose() {
        return this.manager.dispose();
    }
}
/** Publish the runtime only after all persisted rows activate successfully. */
export async function apply(ctx, config = {}) {
    const runtime = new PluginBridgeRuntime(ctx, config);
    await runtime.start();
    const intervalMs = config.autoUpdateIntervalMs ?? 300_000;
    const stopAutoUpdates = intervalMs === 0
        ? async () => undefined
        : startPluginAutoUpdates(async () => {
            try {
                const report = await runtime.syncImportedPlugins();
                for (const update of report.updated) {
                    ctx.logger.info(`plugin bridge updated ${update.name} from ${update.fromVersion ?? 'unknown'} to ${update.toVersion ?? 'unknown'}`);
                }
                for (const diagnostic of report.diagnostics)
                    ctx.logger.warn(`plugin bridge auto-update: ${diagnostic}`);
            }
            catch (error) {
                ctx.logger.warn(`plugin bridge auto-update failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, intervalMs);
    const piUpdateCheckIntervalMs = config.piUpdateCheckIntervalMs ?? 6 * 60 * 60 * 1_000;
    const stopPiUpdateChecks = piUpdateCheckIntervalMs === 0
        ? async () => undefined
        : startPluginAutoUpdates(async () => {
            try {
                const status = await runtime.runScheduledPiUpdateCheck();
                if (status.updates.length > 0) {
                    ctx.logger.info(`plugin bridge found ${status.updates.length} Pi package update(s)`);
                }
            }
            catch (error) {
                ctx.logger.warn(`plugin bridge Pi update check failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, piUpdateCheckIntervalMs);
    ctx.effect(() => async () => {
        await stopAutoUpdates();
        await stopPiUpdateChecks();
        await runtime.dispose();
    }, 'plugin-bridge-runtime rows, reconciliation, and Pi update checks');
}
//# sourceMappingURL=runtime.js.map