import { loadPluginBridgeDiscoveries, loadPluginBridgeView, unwrapPluginBridgeMutation, } from "./view-model.js";
export const PLUGIN_BRIDGE_LOCALE = 'settings.pluginBridge';
/** Project the Remote namespace into callback-only component injection. */
export function createPluginBridgeSettingsFace(api) {
    const load = () => loadPluginBridgeView(api);
    const mutate = async (endpoint, operation) => {
        const snapshot = unwrapPluginBridgeMutation(endpoint, await operation());
        return await loadPluginBridgeDiscoveries(api, snapshot);
    };
    return {
        load,
        rescan: load,
        addMarketplace: location => mutate('addMarketplace', () => api.addMarketplace(location)),
        importMarketplace: ref => mutate('importMarketplace', () => api.importMarketplace(ref)),
        importLocal: ref => mutate('importLocal', () => api.importLocal(ref)),
        install: (name, marketplace) => mutate('installPlugin', () => api.installPlugin(name, marketplace)),
        setEnabled: (name, enabled) => mutate('setEnabled', () => api.setEnabled(name, enabled)),
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