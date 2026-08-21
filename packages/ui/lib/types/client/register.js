import { loadPluginBridgeDiscoveries, loadPluginBridgeView, PluginBridgeInstallError, unwrapPluginBridgeMutation, } from "./view-model.js";
export const PLUGIN_BRIDGE_LOCALE = 'settings.pluginBridge';
/** Project the Remote namespace into callback-only component injection. */
export function createPluginBridgeSettingsFace(api) {
    const load = () => loadPluginBridgeView(api);
    const mutate = async (endpoint, operation) => {
        const snapshot = unwrapPluginBridgeMutation(endpoint, await operation());
        return await loadPluginBridgeDiscoveries(api, snapshot);
    };
    const mutatePi = async (endpoint, operation) => {
        unwrapPluginBridgeMutation(endpoint, await operation());
        return load();
    };
    return {
        load,
        rescan: load,
        addMarketplace: location => mutate('addMarketplace', () => api.addMarketplace(location)),
        importMarketplace: ref => mutate('importMarketplace', () => api.importMarketplace(ref)),
        importLocal: ref => mutate('importLocal', () => api.importLocal(ref)),
        install: async (name, marketplace) => {
            const result = unwrapPluginBridgeMutation('installPlugin', await api.installPlugin(name, marketplace));
            if (result.status === 'failed')
                throw new PluginBridgeInstallError(result.reason);
            return await loadPluginBridgeDiscoveries(api, result.snapshot);
        },
        setEnabled: (name, enabled) => mutate('setEnabled', () => api.setEnabled(name, enabled)),
        checkPiUpdates: () => mutatePi('checkPiUpdates', () => api.checkPiUpdates()),
        setPiUpdateMode: mode => mutatePi('setPiUpdateMode', () => api.setPiUpdateMode(mode)),
        setPiPackageAutoUpdate: (id, enabled) => mutatePi('setPiPackageAutoUpdate', () => api.setPiPackageAutoUpdate(id, enabled)),
        updatePiPackage: id => mutatePi('updatePiPackage', () => api.updatePiPackage(id)),
        updateAllPiPackages: () => mutatePi('updateAllPiPackages', () => api.updateAllPiPackages()),
    };
}
/** Mount the external Remote descriptor, then contribute the settings tab. */
export async function registerPluginBridgeUi(ctx, contribution, component, dictionaries) {
    const disposeRemote = await ctx.remote.$mount(contribution);
    ctx.inject(['remote.agentPluginsBridge'], (scope) => {
        // Cordis service getters are scoped to this injection callback. Capture
        // the generated face now; the slot calls its `inject` option later while
        // rendering, after this service scope has closed.
        const api = scope.remote.agentPluginsBridge;
        scope.effect(() => scope.locale.register(PLUGIN_BRIDGE_LOCALE, dictionaries), 'plugin-bridge-ui: dictionaries');
        const t = scope.locale.bind(PLUGIN_BRIDGE_LOCALE);
        scope.slots.inject('settings.plugins.tab', () => scope.slots.register({
            name: 'settings.plugins.tab',
            id: 'agent-plugins',
            order: 5,
            label: () => t('tab'),
            locale: PLUGIN_BRIDGE_LOCALE,
            inject: () => createPluginBridgeSettingsFace(api),
        }, component));
    });
    return disposeRemote;
}
//# sourceMappingURL=register.js.map